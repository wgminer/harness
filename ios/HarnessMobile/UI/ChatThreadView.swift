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
    @State private var loadError: String?
    @State private var scrollProxy: ScrollViewProxy?

    private var isAwaitingFirstToken: Bool {
        app.chatService.isStreaming && streamingMessageTimestamp == nil
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(messages) { msg in
                        MessageRowView(
                            message: msg,
                            isStreaming: msg.timestamp == streamingMessageTimestamp
                        )
                        .id(rowId(for: msg))
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
        if let ts = streamingMessageTimestamp,
           let index = messages.firstIndex(where: { $0.timestamp == ts && $0.messageRole == .assistant }) {
            let current = messages[index]
            messages[index] = MessageRecord(
                role: MessageRole.assistant.rawValue,
                content: current.content + chunk,
                timestamp: ts,
                model: current.model ?? OpenAIModel.chat
            )
            return
        }

        let ts = Int64(Date().timeIntervalSince1970 * 1000)
        streamingMessageTimestamp = ts
        messages.append(
            MessageRecord(
                role: MessageRole.assistant.rawValue,
                content: chunk,
                timestamp: ts,
                model: OpenAIModel.chat
            )
        )
    }

    private func finishStreaming() {
        streamingMessageTimestamp = nil
    }

    private func send(text: String) async {
        guard !text.isEmpty else { return }

        appendOptimisticUserMessage(text)
        finishStreaming()
        scrollToBottom(animated: true)

        do {
            try await app.chatService.send(conversationId: conversationId, userContent: text) { chunk in
                appendStreamingChunk(chunk)
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
        guard let proxy = scrollProxy, let last = messages.last else { return }
        let targetId = rowId(for: last)
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

#Preview("Stop button (streaming)") {
    let app = PreviewSupport.populatedApp()
    return PreviewNavigationRoot {
        ChatThreadView(app: app, conversationId: PreviewSupport.sampleConversationId)
    }
    .onAppear {
        app.chatService.isStreaming = true
    }
}
