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
        let memory = try store.loadUserMemory()
        let selected = MemorySelector.selectRelevant(memory: memory, userContent: lastUser)
        let memoryBlock = MemorySelector.formatBlock(selected: selected)

        var system = """
        [CORE_INSTRUCTIONS]
        You are a helpful assistant in Harness Mobile (iOS).
        Prefer concise, practical, high-signal responses.
        """
        if !memoryBlock.isEmpty {
            system += "\n\n" + memoryBlock
        }

        var messages: [ChatCompletionMessage] = [ChatCompletionMessage(role: "system", content: system)]
        for record in history {
            messages.append(ChatCompletionMessage(role: record.role, content: record.content))
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
    }

    func stop() {
        client?.cancel()
        isStreaming = false
    }
}
