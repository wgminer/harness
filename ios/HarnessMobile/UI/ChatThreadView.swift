import SwiftUI

private enum ChatScrollAnchor {
    static let replying = "replying"
    static let streaming = "streaming"
}

struct ChatThreadView: View {
    @ObservedObject var app: AppModel
    let conversationId: String

    @State private var messages: [MessageRecord] = []
    @State private var streamingMessageTimestamp: Int64?
    @State private var streamingToolCalls: [ToolCallRecord] = []
    @State private var expandedToolCards: Set<Int64> = []
    @State private var loadError: String?
    @State private var scrollProxy: ScrollViewProxy?

    private var isAwaitingFirstToken: Bool {
        app.chatService.isStreaming && streamingMessageTimestamp == nil && streamingToolCalls.isEmpty
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
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
                }
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 16)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composerDock
            }
            .onAppear { scrollProxy = proxy }
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(titleForConversation)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: conversationId) {
            reloadMessages()
            scrollToBottom(animated: false)
            if let text = app.takePendingOutboundMessage(conversationId: conversationId) {
                await send(text: text)
            }
        }
        .alert("Error", isPresented: .constant(loadError != nil)) {
            Button("OK") { loadError = nil }
        } message: {
            Text(loadError ?? "")
        }
    }

    @State private var streamingContent = ""

    private var composerDock: some View {
        ChatComposerView(
            conversationId: conversationId,
            isStreaming: app.chatService.isStreaming,
            onSend: { text in Task { await send(text: text) } },
            onStop: { app.chatService.stop() }
        )
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background {
            LinearGradient(
                colors: [
                    Color(.systemGroupedBackground).opacity(0),
                    Color(.systemGroupedBackground).opacity(0.92),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
        }
    }

    private var titleForConversation: String {
        app.store.conversations.first(where: { $0.id == conversationId })?.displayTitle ?? "Chat"
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

    private func send(text: String) async {
        guard !text.isEmpty else { return }

        appendOptimisticUserMessage(text)
        finishStreaming()
        scrollToBottom(animated: true)

        do {
            try await app.chatService.send(conversationId: conversationId, userContent: text) { chunk in
                appendStreamingChunk(chunk)
            } onToolCall: { call in
                appendStreamingToolCall(call)
            }
            finishStreaming()
            reloadMessages()
            await app.pushAfterChat()
        } catch {
            loadError = error.localizedDescription
            finishStreaming()
            reloadMessages()
        }
    }

    private func scrollToBottom(animated: Bool) {
        guard let proxy = scrollProxy else { return }
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
        Task { @MainActor in
            if animated {
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(targetId, anchor: .bottom)
                }
            } else {
                proxy.scrollTo(targetId, anchor: .bottom)
            }
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
