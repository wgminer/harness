import Foundation

enum ChatServiceError: LocalizedError {
    case missingUserMessage

    var errorDescription: String? {
        switch self {
        case .missingUserMessage:
            return "No user message to polish."
        }
    }
}

@MainActor
final class ChatService: ObservableObject {
    @Published var isStreaming = false

    private let store: ConversationStore
    private let tasksStore: TasksStore
    let gatedToolCoordinator: GatedToolCoordinator
    private var taskToolExecutor: TaskToolExecutor?
    private var client: OpenAIClient?
    private var titleRefinementTasks: [String: Task<Void, Never>] = [:]

    init(store: ConversationStore, tasksStore: TasksStore) {
        self.store = store
        self.tasksStore = tasksStore
        self.gatedToolCoordinator = GatedToolCoordinator()
        self.taskToolExecutor = TaskToolExecutor(
            tasksStore: tasksStore,
            gatedToolCoordinator: gatedToolCoordinator
        )
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
        Available tools: task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_search_conversations (search all prior chats for a free-text query when the user asks about past conversations or needs recall across threads). Call them when appropriate.
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
        onStreamChunk: @escaping (String) -> Void,
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        guard let taskToolExecutor else { throw OpenAIError.missingAPIKey }
        let trimmed = userContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isStreaming = true
        defer { isStreaming = false }

        try appendMessage(conversationId: conversationId, role: .user, content: trimmed)
        let apiMessages = try buildMessages(conversationId: conversationId)

        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools,
            executeTool: { [weak self] name, args in
                guard let self else {
                    return #"{"error":"Chat unavailable"}"#
                }
                if TaskToolDefinitions.gatedToolNames.contains(name) {
                    onToolCall(ToolCallRecord(toolName: name, payload: [
                        "pending": true,
                        "tool": name,
                        "args": args,
                    ]))
                }
                let toolResult: String
                if TaskToolDefinitions.toolNames.contains(name) {
                    guard let taskToolExecutor = self.taskToolExecutor else {
                        return #"{"error":"Chat unavailable"}"#
                    }
                    toolResult = try await taskToolExecutor.execute(name: name, args: args)
                } else if ChatToolDefinitions.toolNames.contains(name) {
                    toolResult = try AssistantTools.execute(name: name, args: args, store: self.store)
                } else {
                    toolResult = #"{"error":"Unknown tool: \(name)"}"#
                }
                if AssistantToolDefinitions.trackedToolNames.contains(name),
                   let payload = self.parseJSONObject(toolResult) {
                    onToolCall(ToolCallRecord(toolName: name, payload: payload))
                }
                return toolResult
            },
            onChunk: onStreamChunk
        )

        try appendMessage(
            conversationId: conversationId,
            role: .assistant,
            content: ChatTemporalContext.stripSentAtPrefix(result.content),
            model: OpenAIModel.chat,
            toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls
        )
        scheduleTitleRefinement(conversationId: conversationId)
    }

    /// Stream assistant reply without adding a new user message.
    func generateReply(
        conversationId: String,
        onStreamChunk: @escaping (String) -> Void,
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        isStreaming = true
        defer { isStreaming = false }

        let apiMessages = try buildMessages(conversationId: conversationId)
        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools,
            executeTool: { [weak self] name, args in
                guard let self else { return #"{"error":"Chat unavailable"}"# }
                if TaskToolDefinitions.gatedToolNames.contains(name) {
                    onToolCall(ToolCallRecord(toolName: name, payload: [
                        "pending": true,
                        "tool": name,
                        "args": args,
                    ]))
                }
                let toolResult: String
                if TaskToolDefinitions.toolNames.contains(name) {
                    guard let taskToolExecutor = self.taskToolExecutor else {
                        return #"{"error":"Chat unavailable"}"#
                    }
                    toolResult = try await taskToolExecutor.execute(name: name, args: args)
                } else if ChatToolDefinitions.toolNames.contains(name) {
                    toolResult = try AssistantTools.execute(name: name, args: args, store: self.store)
                } else {
                    toolResult = #"{"error":"Unknown tool: \(name)"}"#
                }
                if AssistantToolDefinitions.trackedToolNames.contains(name),
                   let payload = self.parseJSONObject(toolResult) {
                    onToolCall(ToolCallRecord(toolName: name, payload: payload))
                }
                return toolResult
            },
            onChunk: onStreamChunk
        )

        try appendMessage(
            conversationId: conversationId,
            role: .assistant,
            content: ChatTemporalContext.stripSentAtPrefix(result.content),
            model: OpenAIModel.chat,
            toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls
        )
        scheduleTitleRefinement(conversationId: conversationId)
    }

    /// Pop last user message, send polish instruction + transcript, stream assistant reply.
    func polishLastUser(
        conversationId: String,
        onStreamChunk: @escaping (String) -> Void,
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        guard let taskToolExecutor else { throw OpenAIError.missingAPIKey }
        guard let transcript = try store.popLastUserMessage(conversationId: conversationId) else {
            throw ChatServiceError.missingUserMessage
        }

        isStreaming = true
        defer { isStreaming = false }

        try appendMessage(conversationId: conversationId, role: .user, content: DictationPolish.instruction)
        try appendMessage(conversationId: conversationId, role: .user, content: transcript)
        let apiMessages = try buildMessages(conversationId: conversationId)
        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools,
            executeTool: { [weak self] name, args in
                guard let self else { return #"{"error":"Chat unavailable"}"# }
                if TaskToolDefinitions.gatedToolNames.contains(name) {
                    onToolCall(ToolCallRecord(toolName: name, payload: [
                        "pending": true,
                        "tool": name,
                        "args": args,
                    ]))
                }
                let toolResult: String
                if TaskToolDefinitions.toolNames.contains(name) {
                    guard let taskToolExecutor = self.taskToolExecutor else {
                        return #"{"error":"Chat unavailable"}"#
                    }
                    toolResult = try await taskToolExecutor.execute(name: name, args: args)
                } else if ChatToolDefinitions.toolNames.contains(name) {
                    toolResult = try AssistantTools.execute(name: name, args: args, store: self.store)
                } else {
                    toolResult = #"{"error":"Unknown tool: \(name)"}"#
                }
                if AssistantToolDefinitions.trackedToolNames.contains(name),
                   let payload = self.parseJSONObject(toolResult) {
                    onToolCall(ToolCallRecord(toolName: name, payload: payload))
                }
                return toolResult
            },
            onChunk: onStreamChunk
        )
        try appendMessage(
            conversationId: conversationId,
            role: .assistant,
            content: ChatTemporalContext.stripSentAtPrefix(result.content),
            model: OpenAIModel.chat,
            toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls
        )
        scheduleTitleRefinement(conversationId: conversationId)
    }

    func resolveGatedTool(_ action: GatedToolAction) {
        gatedToolCoordinator.resolve(action)
    }

    private func parseJSONObject(_ raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return json
    }

    /// Mirrors desktop `appendMessageIn`: schedule title LLM after each user message.
    private func appendMessage(
        conversationId: String,
        role: MessageRole,
        content: String,
        model: String? = nil,
        toolCalls: [ToolCallRecord]? = nil
    ) throws {
        try store.appendMessage(
            conversationId: conversationId,
            role: role,
            content: content,
            model: model,
            toolCalls: toolCalls
        )
        if role == .user {
            scheduleTitleRefinement(conversationId: conversationId)
        }
    }

    func scheduleTitleRefinement(conversationId: String) {
        titleRefinementTasks[conversationId]?.cancel()
        titleRefinementTasks[conversationId] = Task {
            defer { titleRefinementTasks[conversationId] = nil }
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
        gatedToolCoordinator.cancelPending()
        isStreaming = false
    }
}
