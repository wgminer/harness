import SwiftUI

private enum ChatScrollAnchor {
    static let replying = "replying"
    static let streaming = "streaming"
}

private enum ChatThreadLayout {
    static let horizontalInset: CGFloat = 16
}

struct ChatThreadView: View {
    @ObservedObject var app: AppModel
    @Environment(\.harnessTheme) private var theme
    let conversationId: String

    @StateObject private var scrollController = ChatScrollController()

    @State private var messages: [MessageRecord]
    @State private var streamingMessageTimestamp: Int64?
    @State private var streamingToolCalls: [ToolCallRecord] = []
    @State private var expandedToolCards: Set<Int64> = []
    @State private var loadError: String?
    @State private var scrollProxy: ScrollViewProxy?
    @State private var isDictationSession: Bool
    @State private var didAutoGenerateReply = false
    @State private var showRenameAlert = false
    @State private var renameDraft = ""
    @State private var showDeleteConfirm = false
    @State private var scrollContentOffset: CGFloat = 0
    @State private var scrollContentBottom: CGFloat = 0
    @State private var scrollViewportBottom: CGFloat = 0
    @State private var didInitialScrollToLiveEdge = false
    @State private var showDictationSheet = false
    @FocusState private var isComposerFocused: Bool

    private let autofocusComposer: Bool

    init(app: AppModel, conversationId: String) {
        self.app = app
        self.conversationId = conversationId
        autofocusComposer = false
        _messages = State(
            initialValue: (try? app.store.loadMessages(conversationId: conversationId)) ?? []
        )
        _isDictationSession = State(
            initialValue: (try? app.store.loadConversationMeta(conversationId: conversationId)?.sessionKind) == "dictation"
        )
    }

    private var isStreamingThisThread: Bool {
        app.chatService.isStreaming(conversationId: conversationId)
    }

    private var isAwaitingFirstToken: Bool {
        isStreamingThisThread && streamingMessageTimestamp == nil && streamingToolCalls.isEmpty
    }

    private var centerSingleMessage: Bool {
        isDictationSession
            && messages.count == 1
            && messages.first?.messageRole == .user
            && !isStreamingThisThread
            && !isAwaitingFirstToken
    }

    private var showReplyActions: Bool {
        guard isDictationSession, let last = messages.last else { return false }
        return last.messageRole == .user
            && !isStreamingThisThread
            && streamingMessageTimestamp == nil
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ChatScrollOffsetTracker()

                    if centerSingleMessage {
                        Spacer(minLength: 0)
                    }

                    ForEach(messages) { msg in
                        MessageRowView(
                            message: msg,
                            isStreaming: msg.timestamp == streamingMessageTimestamp,
                            toolCallsExpanded: expandedToolCards.contains(msg.timestamp ?? -1),
                            onToggleToolCallsExpanded: {
                                toggleToolCard(for: msg.timestamp)
                            },
                            onToolConfirm: { call, action in
                                handleToolConfirm(call: call, action: action, messageTimestamp: msg.timestamp)
                            }
                        )
                        .id(rowId(for: msg))
                    }

                    if showReplyActions {
                        DictationReplyStrip(
                            showPolish: isDictationSession,
                            onContinue: { Task { await generateReply() } },
                            onPolish: { Task { await polishLastUser() } }
                        )
                        .id("dictation-reply-strip")
                    }

                    if let streamingTimestamp = streamingMessageTimestamp {
                        MessageRowView(
                            message: MessageRecord(
                                role: MessageRole.assistant.rawValue,
                                content: streamingContent,
                                timestamp: streamingTimestamp,
                                model: OpenAIModel.chat,
                                toolCalls: streamingToolCalls.isEmpty ? nil : streamingToolCalls
                            ),
                            isStreaming: true,
                            toolCallsExpanded: expandedToolCards.contains(streamingTimestamp),
                            onToggleToolCallsExpanded: {
                                toggleToolCard(for: streamingTimestamp)
                            },
                            onToolConfirm: { call, action in
                                handleToolConfirm(call: call, action: action, messageTimestamp: streamingTimestamp)
                            }
                        )
                        .id(ChatScrollAnchor.streaming)
                    }
                    if isAwaitingFirstToken {
                        ReplyingIndicatorView()
                            .id(ChatScrollAnchor.replying)
                    }

                    if centerSingleMessage {
                        Spacer(minLength: 0)
                    }

                    ChatScrollOffsetTracker()
                }
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
                .frame(minHeight: centerSingleMessage ? minScrollHeight : nil, alignment: centerSingleMessage ? .center : .top)
                .padding(.horizontal, ChatThreadLayout.horizontalInset)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .coordinateSpace(name: "chatScroll")
            .background(ChatScrollViewportTracker())
            .modifier(
                ChatScrollPreferenceHandlers(
                    controller: scrollController,
                    contentOffset: $scrollContentOffset,
                    contentBottom: $scrollContentBottom,
                    viewportBottom: $scrollViewportBottom
                )
            )
            .scrollDisabled(centerSingleMessage)
            .defaultScrollAnchor(centerSingleMessage ? .center : .top)
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        if value.translation.height > 0 {
                            scrollController.onUserDraggedUp()
                        }
                    }
            )
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composerDock
            }
            .onAppear { scrollProxy = proxy }
            .onChange(of: scrollContentBottom) { _, bottom in
                guard !didInitialScrollToLiveEdge,
                      bottom > 0,
                      !centerSingleMessage,
                      !messages.isEmpty else { return }
                didInitialScrollToLiveEdge = true
                scrollToBottom(animated: false)
            }
        }
        .background(theme.bgColor.ignoresSafeArea())
        .navigationTitle(titleForConversation)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        renameDraft = titleForConversation
                        showRenameAlert = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .alert("Rename conversation", isPresented: $showRenameAlert) {
            TextField("Title", text: $renameDraft)
            Button("Save") {
                renameConversation(title: renameDraft)
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete conversation?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                deleteConversation()
            }
        } message: {
            Text("This chat and its messages will be removed from this device and synced to your Mac.")
        }
        .task(id: conversationId) {
            scrollController.reset()
            didInitialScrollToLiveEdge = false
            reloadMessages()
            loadSessionKind()
            if let text = app.takePendingOutboundMessage(conversationId: conversationId) {
                await send(text: text)
            } else if app.takePendingAutoGenerateReply(conversationId: conversationId), !didAutoGenerateReply {
                didAutoGenerateReply = true
                await generateReply()
            }
        }
        .onChange(of: isStreamingThisThread) { _, sending in
            scrollController.onSendingChange(sending)
            if sending {
                followLiveEdgeIfPinned(animated: true)
            }
        }
        .onChange(of: streamingContent) { _, _ in
            followLiveEdgeIfPinned(animated: false)
        }
        .onChange(of: messages.count) { _, _ in
            followLiveEdgeIfPinned(animated: false)
        }
        .onDisappear {
            app.flushComposerDrafts()
        }
        .alert("Error", isPresented: .constant(loadError != nil)) {
            Button("OK") { loadError = nil }
        } message: {
            Text(loadError ?? "")
        }
        .sheet(isPresented: $showDictationSheet) {
            DictationRecordingSheet(
                app: app,
                mode: .sendToConversation(conversationId: conversationId),
                isPresented: $showDictationSheet,
                onTranscriptSent: { transcript in
                    Task { await send(text: transcript) }
                }
            )
        }
    }

    @State private var streamingContent = ""

    private var minScrollHeight: CGFloat {
        UIScreen.main.bounds.height * 0.55
    }

    private var composerDock: some View {
        ChatComposerView(
            conversationId: conversationId,
            isStreaming: isStreamingThisThread,
            autofocusOnAppear: autofocusComposer,
            startsExpanded: app.hasPendingOutboundMessage(conversationId: conversationId),
            allowsCollapse: true,
            initialDraft: app.cachedComposerDraft(conversationId: conversationId),
            onDraftChange: { app.cacheComposerDraft($0, conversationId: conversationId) },
            onClearDraft: { app.clearComposerDraft(conversationId: conversationId) },
            onSend: { text in Task { await send(text: text) } },
            onStop: { app.chatService.stop() },
            onDictate: { showDictationSheet = true },
            isFocused: $isComposerFocused
        )
        .padding(.horizontal, ChatThreadLayout.horizontalInset)
        .padding(.bottom, BottomBarMetrics.bottomInset)
    }

    private var titleForConversation: String {
        app.store.conversations.first(where: { $0.id == conversationId })?.displayTitle ?? "Chat"
    }

    private func loadSessionKind() {
        isDictationSession = (try? app.store.loadConversationMeta(conversationId: conversationId)?.sessionKind) == "dictation"
    }

    private func rowId(for message: MessageRecord) -> String {
        if message.timestamp == streamingMessageTimestamp {
            return ChatScrollAnchor.streaming
        }
        return message.id
    }

    private func toggleToolCard(for timestamp: Int64?) {
        guard let timestamp else { return }
        if expandedToolCards.contains(timestamp) {
            expandedToolCards.remove(timestamp)
        } else {
            expandedToolCards.insert(timestamp)
        }
    }

    private func handleToolConfirm(call: ToolCallRecord, action: GatedToolAction, messageTimestamp: Int64?) {
        app.chatService.resolveGatedTool(action)
        guard let messageTimestamp else { return }
        updateToolCallPendingState(timestamp: messageTimestamp, toolName: call.toolName, action: action)
    }

    private func updateToolCallPendingState(timestamp: Int64, toolName: String, action: GatedToolAction) {
        if timestamp == streamingMessageTimestamp {
            streamingToolCalls = streamingToolCalls.map { call in
                guard call.toolName == toolName, call.isPending else { return call }
                var payload = call.payloadDictionary ?? [:]
                payload["pending"] = false
                if action == .cancel {
                    payload["cancelled"] = true
                }
                return ToolCallRecord(toolName: call.toolName, payload: payload)
            }
            return
        }

        messages = messages.map { message in
            guard message.timestamp == timestamp, var toolCalls = message.toolCalls else { return message }
            toolCalls = toolCalls.map { call in
                guard call.toolName == toolName, call.isPending else { return call }
                var payload = call.payloadDictionary ?? [:]
                payload["pending"] = false
                if action == .cancel {
                    payload["cancelled"] = true
                }
                return ToolCallRecord(toolName: call.toolName, payload: payload)
            }
            return MessageRecord(
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                model: message.model,
                toolCalls: toolCalls
            )
        }
    }

    private func reloadMessages() {
        do {
            messages = try app.store.loadMessages(conversationId: conversationId)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func appendOptimisticUserMessage(_ text: String) {
        let record = MessageRecord(
            role: MessageRole.user.rawValue,
            content: text,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            model: nil
        )
        if messages.last?.content == text, messages.last?.messageRole == .user {
            return
        }
        messages.append(record)
    }

    private func appendStreamingChunk(_ chunk: String) {
        guard !chunk.isEmpty else { return }
        streamingContent = ChatTemporalContext.stripSentAtPrefix(streamingContent + chunk)
        if streamingMessageTimestamp == nil {
            streamingMessageTimestamp = Int64(Date().timeIntervalSince1970 * 1000)
        }
    }

    private func appendStreamingToolCall(_ call: ToolCallRecord) {
        if streamingMessageTimestamp == nil {
            streamingMessageTimestamp = Int64(Date().timeIntervalSince1970 * 1000)
        }
        if let index = streamingToolCalls.firstIndex(where: { $0.toolName == call.toolName }) {
            streamingToolCalls[index] = call
        } else {
            streamingToolCalls.append(call)
        }
    }

    private func finishStreaming() {
        streamingMessageTimestamp = nil
        streamingContent = ""
        streamingToolCalls = []
    }

    private func commitStreamingToMessages() {
        guard let timestamp = streamingMessageTimestamp else { return }
        let content = ChatTemporalContext.stripSentAtPrefix(streamingContent)
        guard !content.isEmpty || !streamingToolCalls.isEmpty else {
            finishStreaming()
            return
        }
        let record = MessageRecord(
            role: MessageRole.assistant.rawValue,
            content: content,
            timestamp: timestamp,
            model: OpenAIModel.chat,
            toolCalls: streamingToolCalls.isEmpty ? nil : streamingToolCalls
        )
        if !messages.contains(where: { $0.timestamp == timestamp && $0.messageRole == .assistant }) {
            messages.append(record)
        }
        finishStreaming()
    }

    private func send(text: String) async {
        guard !text.isEmpty else { return }

        appendOptimisticUserMessage(text)
        finishStreaming()
        scrollController.pinForTurn()
        followLiveEdgeIfPinned(animated: true)

        do {
            try await app.chatService.send(conversationId: conversationId, userContent: text) { chunk in
                appendStreamingChunk(chunk)
            } onToolCall: { call in
                appendStreamingToolCall(call)
            }
            commitStreamingToMessages()
            reloadMessages()
            await app.pushAfterChat()
        } catch is CancellationError {
            finishStreaming()
            reloadMessages()
        } catch ChatServiceError.cancelled {
            finishStreaming()
            reloadMessages()
        } catch {
            loadError = error.localizedDescription
            finishStreaming()
            reloadMessages()
        }
    }

    private func generateReply() async {
        finishStreaming()
        scrollController.pinForTurn()
        followLiveEdgeIfPinned(animated: true)

        do {
            try await app.chatService.generateReply(conversationId: conversationId) { chunk in
                appendStreamingChunk(chunk)
            } onToolCall: { call in
                appendStreamingToolCall(call)
            }
            commitStreamingToMessages()
            reloadMessages()
            await app.pushAfterChat()
        } catch is CancellationError {
            finishStreaming()
            reloadMessages()
        } catch ChatServiceError.cancelled {
            finishStreaming()
            reloadMessages()
        } catch {
            loadError = error.localizedDescription
            finishStreaming()
            reloadMessages()
        }
    }

    private func polishLastUser() async {
        finishStreaming()
        scrollController.pinForTurn()
        followLiveEdgeIfPinned(animated: true)

        do {
            try await app.chatService.polishLastUser(conversationId: conversationId) { chunk in
                appendStreamingChunk(chunk)
            } onToolCall: { call in
                appendStreamingToolCall(call)
            }
            commitStreamingToMessages()
            reloadMessages()
            isDictationSession = false
            await app.pushAfterChat()
        } catch is CancellationError {
            finishStreaming()
            reloadMessages()
        } catch ChatServiceError.cancelled {
            finishStreaming()
            reloadMessages()
        } catch {
            loadError = error.localizedDescription
            finishStreaming()
            reloadMessages()
        }
    }

    private func followLiveEdgeIfPinned(animated: Bool) {
        guard scrollController.shouldFollow, !centerSingleMessage else { return }
        scrollToBottom(animated: animated)
    }

    private func scrollToBottom(animated: Bool) {
        guard let proxy = scrollProxy else { return }
        if centerSingleMessage { return }
        let targetId: String
        if streamingMessageTimestamp != nil {
            targetId = ChatScrollAnchor.streaming
        } else if isAwaitingFirstToken {
            targetId = ChatScrollAnchor.replying
        } else if let last = messages.last {
            targetId = rowId(for: last)
        } else {
            return
        }
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(targetId, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(targetId, anchor: .bottom)
        }
    }

    private func renameConversation(title: String) {
        do {
            try app.store.setUserTitle(conversationId: conversationId, title: title)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func deleteConversation() {
        do {
            app.clearComposerDraft(conversationId: conversationId)
            try app.deleteConversation(id: conversationId)
        } catch {
            loadError = error.localizedDescription
        }
    }
}

#Preview("Thread") {
    PreviewNavigationRoot {
        ChatThreadView(
            app: PreviewSupport.populatedApp(),
            conversationId: PreviewSupport.sampleConversationId
        )
    }
}
