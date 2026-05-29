import Foundation

@MainActor
final class ChatService: ObservableObject {
    @Published var isStreaming = false
    @Published var errorMessage: String?

    private let store: ConversationStore
    private var client: OpenAIClient?

    init(store: ConversationStore) {
        self.store = store
    }

    func refreshClient() {
        if let key = KeychainStore.loadAPIKey(), !key.isEmpty {
            client = OpenAIClient(apiKey: key)
        } else {
            client = nil
        }
    }

    func buildMessages(conversationId: String) throws -> [ChatCompletionMessage] {
        let history = try store.loadMessages(conversationId: conversationId)
        let lastUser = history.last(where: { $0.messageRole == .user })?.content ?? ""
        let strategy = try store.loadMemoryInjectionStrategy()
        let memory = try store.loadUserMemory()
        let selected = MemorySelector.selectForPrompt(strategy: strategy, memory: memory, userContent: lastUser)
        let memoryBlock = MemorySelector.formatBlock(selected: selected)

        var system = """
        [CORE_INSTRUCTIONS]
        You are a helpful assistant in Harness Mobile (iOS).
        Prefer concise, practical, high-signal responses.
        """
        if !memoryBlock.isEmpty {
            system += "\n\n" + memoryBlock
        }
        system += "\n\n" + ChatTemporalContext.temporalContextBlock()

        var messages: [ChatCompletionMessage] = [ChatCompletionMessage(role: "system", content: system)]
        for record in history {
            let content = ChatTemporalContext.annotateMessageContentForModel(
                record.content,
                timestampMs: record.timestamp
            )
            messages.append(ChatCompletionMessage(role: record.role, content: content))
        }
        return messages
    }

    func send(
        conversationId: String,
        userContent: String,
        onStreamChunk: @escaping (String) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        let trimmed = userContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        errorMessage = nil
        isStreaming = true
        defer { isStreaming = false }

        try store.appendMessage(conversationId: conversationId, role: .user, content: trimmed)
        let apiMessages = try buildMessages(conversationId: conversationId)

        let full = try await client.streamChat(messages: apiMessages, onChunk: onStreamChunk)
        try store.appendMessage(
            conversationId: conversationId,
            role: .assistant,
            content: full,
            model: OpenAIModel.chat
        )
        scheduleTitleRefinement(conversationId: conversationId)
    }

    func scheduleTitleRefinement(conversationId: String) {
        Task {
            guard let client else { return }
            do {
                let messages = try store.loadMessages(conversationId: conversationId)
                let map = try store.loadConversationMeta(conversationId: conversationId)
                guard let meta = map else { return }
                if meta.titleSource == "user" || meta.titleSource == "imported" { return }
                guard ConversationTitlePolicy.shouldRefine(messages: messages, title: meta.title) else { return }

                let context = ConversationTitlePolicy.buildContext(messages: messages)
                guard !context.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

                let previousTitle: String? = {
                    let t = meta.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if t.isEmpty || ConversationTitlePolicy.isTimePlaceholderTitle(meta.title) { return nil }
                    return t
                }()

                guard let rawTitle = try await client.generateThreadTitle(
                    previousTitle: previousTitle,
                    context: context
                ), !rawTitle.isEmpty else { return }

                try store.patchConversationMeta(
                    conversationId: conversationId,
                    title: rawTitle,
                    titleSource: "auto"
                )
            } catch {
                // Title generation is best-effort; chat already succeeded.
            }
        }
    }

    func stop() {
        client?.cancel()
        isStreaming = false
    }
}
