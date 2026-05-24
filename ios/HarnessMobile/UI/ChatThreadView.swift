import SwiftUI

struct ChatThreadView: View {
    @ObservedObject var app: AppModel
    let conversationId: String

    @State private var messages: [MessageRecord] = []
    @State private var input = ""
    @State private var streamingText = ""
    @State private var loadError: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(messages.enumerated()), id: \.offset) { _, msg in
                        messageBubble(msg)
                    }
                    if !streamingText.isEmpty {
                        messageBubble(MessageRecord(
                            role: "assistant",
                            content: streamingText,
                            timestamp: nil,
                            model: OpenAIModel.chat
                        ))
                        .id("streaming")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onChange(of: streamingText) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composerDock
            }
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(titleForConversation)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: conversationId) {
            reloadMessages()
        }
        .alert("Error", isPresented: .constant(loadError != nil)) {
            Button("OK") { loadError = nil }
        } message: {
            Text(loadError ?? "")
        }
    }

    private var composerDock: some View {
        ChatComposerView(
            text: $input,
            isStreaming: app.chatService.isStreaming,
            focusTrigger: conversationId,
            onSend: { Task { await send() } },
            onStop: { app.chatService.stop() }
        )
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background {
            // Soft fade so messages don't clash with the glass dock
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

    @ViewBuilder
    private func messageBubble(_ msg: MessageRecord) -> some View {
        let isUser = msg.messageRole == .user
        HStack(alignment: .bottom, spacing: 0) {
            if isUser { Spacer(minLength: 48) }
            Text(msg.content)
                .font(.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(isUser ? Color.accentColor.opacity(0.14) : Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !isUser { Spacer(minLength: 48) }
        }
    }

    private func reloadMessages() {
        do {
            messages = try app.store.loadMessages(conversationId: conversationId)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func send() async {
        let text = input
        input = ""
        streamingText = ""
        do {
            try await app.chatService.send(conversationId: conversationId, userContent: text) { chunk in
                streamingText += chunk
            }
            streamingText = ""
            reloadMessages()
            await app.pushAfterChat()
        } catch {
            loadError = error.localizedDescription
            reloadMessages()
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            if !streamingText.isEmpty {
                proxy.scrollTo("streaming", anchor: .bottom)
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
