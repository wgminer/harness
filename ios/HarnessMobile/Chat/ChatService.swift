import Foundation

enum ChatServiceError: LocalizedError {
    case missingUserMessage
    case cancelled

    var errorDescription: String? {
        switch self {
        case .missingUserMessage:
            return "No user message to polish."
        case .cancelled:
            return nil
        }
    }
}

@MainActor
final class ChatService: ObservableObject {
    @Published private(set) var streamingConversationId: String?

    var isStreaming: Bool { streamingConversationId != nil }

    private var userStoppedStream = false

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

    func isStreaming(conversationId: String) -> Bool {
        streamingConversationId == conversationId
    }

    private func beginStreaming(conversationId: String) {
        streamingConversationId = conversationId
        userStoppedStream = false
    }

    private func endStreaming() {
        streamingConversationId = nil
    }

    private func throwIfStopped() throws {
        if userStoppedStream {
            userStoppedStream = false
            throw ChatServiceError.cancelled
        }
    }

    /// Loads history / memory / recent-chat context off the main actor so Send
    /// does not freeze the UI while reading dozens of message JSON files.
    func buildMessages(conversationId: String) async throws -> [ChatCompletionMessage] {
        let dir = store.localDataDir
        return try await Task.detached(priority: .userInitiated) {
            try Self.assembleMessages(localDataDir: dir, conversationId: conversationId)
        }.value
    }

    nonisolated private static func assembleMessages(
        localDataDir: URL,
        conversationId: String
    ) throws -> [ChatCompletionMessage] {
        let history = try ConversationStore.loadMessages(
            localDataDir: localDataDir,
            conversationId: conversationId
        )
        let memory = try ConversationStore.loadUserMemory(in: localDataDir)
        let selected = MemorySelector.sortedEntries(memory: memory)
        let memoryBlock = MemorySelector.formatBlock(selected: selected)
        let recentConversationsBlock = try RecentConversations.buildBlock(
            localDataDir: localDataDir,
            excludeConversationId: conversationId
        )
        let systemPromptSettings = SystemPromptSettings.load(from: localDataDir)
        let includeWebSearch = AssistantToolDefinitions.hasTavilyApiKey(in: localDataDir)
        let system = systemPromptSettings.assembledSystemPrompt(
            memoryBlock: memoryBlock,
            recentConversationsBlock: recentConversationsBlock,
            temporalContext: ChatTemporalContext.temporalContextBlock(),
            platform: .ios,
            includeWebSearch: includeWebSearch
        )

        var messages: [ChatCompletionMessage] = [ChatCompletionMessage(role: "system", content: system)]
        for record in history {
            let content = ChatTemporalContext.annotateMessageContentForModel(
                record.content,
                timestampMs: record.timestamp
            )
            if let attachments = record.attachments, !attachments.isEmpty {
                var parts: [ChatCompletionContentPart] = []
                if !content.isEmpty {
                    parts.append(.text(content))
                }
                for attachment in attachments where attachment.mimeType.hasPrefix("image/") {
                    let url = LocalDataLayout.fileURL(
                        in: localDataDir,
                        relativePath: attachment.relativePath
                    )
                    if let data = try? Data(contentsOf: url), !data.isEmpty {
                        parts.append(.imageJPEG(data))
                    }
                }
                if parts.isEmpty {
                    messages.append(ChatCompletionMessage(role: record.role, content: content))
                } else {
                    messages.append(ChatCompletionMessage(role: record.role, contentParts: parts))
                }
            } else {
                messages.append(ChatCompletionMessage(role: record.role, content: content))
            }
        }
        return messages
    }

    func send(
        conversationId: String,
        userContent: String,
        imageJPEG: Data? = nil,
        attachments: [MessageAttachment]? = nil,
        onStreamChunk: @escaping (String) -> Void,
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        guard let taskToolExecutor else { throw OpenAIError.missingAPIKey }
        let trimmed = userContent.trimmingCharacters(in: .whitespacesAndNewlines)
        var resolvedAttachments = attachments
        if resolvedAttachments == nil, let imageJPEG {
            resolvedAttachments = [try store.saveChatImageAttachment(
                conversationId: conversationId,
                jpegData: imageJPEG
            )]
        }
        guard !trimmed.isEmpty || resolvedAttachments != nil else { return }

        beginStreaming(conversationId: conversationId)
        defer { endStreaming() }

        try appendMessage(
            conversationId: conversationId,
            role: .user,
            content: trimmed,
            attachments: resolvedAttachments
        )
        let apiMessages = try await buildMessages(conversationId: conversationId)

        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools(in: store.localDataDir),
            executeTool: makeToolExecutor(onToolCall: onToolCall),
            onChunk: onStreamChunk
        )
        try throwIfStopped()
        try finishAssistantTurn(conversationId: conversationId, result: result)
    }

    /// Stream assistant reply without adding a new user message.
    func generateReply(
        conversationId: String,
        onStreamChunk: @escaping (String) -> Void,
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) async throws {
        guard let client else { throw OpenAIError.missingAPIKey }
        beginStreaming(conversationId: conversationId)
        defer { endStreaming() }

        let apiMessages = try await buildMessages(conversationId: conversationId)
        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools(in: store.localDataDir),
            executeTool: makeToolExecutor(onToolCall: onToolCall),
            onChunk: onStreamChunk
        )
        try throwIfStopped()
        try finishAssistantTurn(conversationId: conversationId, result: result)
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

        beginStreaming(conversationId: conversationId)
        defer { endStreaming() }

        try appendMessage(conversationId: conversationId, role: .user, content: DictationPolish.instruction)
        try appendMessage(conversationId: conversationId, role: .user, content: transcript)
        let apiMessages = try await buildMessages(conversationId: conversationId)
        let result = try await client.streamChatWithTools(
            messages: apiMessages,
            tools: AssistantToolDefinitions.openAITools(in: store.localDataDir),
            executeTool: makeToolExecutor(onToolCall: onToolCall),
            onChunk: onStreamChunk
        )
        try throwIfStopped()
        try finishAssistantTurn(conversationId: conversationId, result: result)
    }

    private func finishAssistantTurn(
        conversationId: String,
        result: ChatCompletionResult
    ) throws {
        try appendMessage(
            conversationId: conversationId,
            role: .assistant,
            content: ChatTemporalContext.stripSentAtPrefix(result.content),
            model: OpenAIModel.chat,
            toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls
        )
        scheduleTitleRefinement(conversationId: conversationId)
    }

    private func makeToolExecutor(
        onToolCall: @escaping (ToolCallRecord) -> Void
    ) -> (String, [String: Any]) async throws -> String {
        { [weak self] name, args in
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
                toolResult = try await AssistantTools.execute(name: name, args: args, store: self.store)
            } else {
                toolResult = #"{"error":"Unknown tool: \(name)"}"#
            }
            if AssistantToolDefinitions.trackedToolNames.contains(name),
               let payload = self.parseJSONObject(toolResult) {
                onToolCall(ToolCallRecord(toolName: name, payload: payload))
            }
            return toolResult
        }
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
        toolCalls: [ToolCallRecord]? = nil,
        attachments: [MessageAttachment]? = nil
    ) throws {
        try store.appendMessage(
            conversationId: conversationId,
            role: role,
            content: content,
            model: model,
            toolCalls: toolCalls,
            attachments: attachments
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
        userStoppedStream = true
        client?.cancel()
        gatedToolCoordinator.cancelPending()
        endStreaming()
    }
}
