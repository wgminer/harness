import Foundation

@MainActor
final class ConversationStore: ObservableObject {
    @Published private(set) var conversations: [ConversationListItem] = []
    @Published private(set) var hasLocalEdits = false

    let localDataDir: URL

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    func reload() throws {
        let map = try loadConversationMap()
        conversations = map
            .map { id, meta in
                ConversationListItem(
                    id: id,
                    title: meta.title,
                    createdAt: meta.createdAt,
                    hasAssistantReply: meta.hasAssistantReply ?? false
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func loadConversationMeta(conversationId: String) throws -> ConversationMeta? {
        try loadConversationMapRaw()[conversationId]
    }

    func loadMessages(conversationId: String) throws -> [MessageRecord] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.messagesPath(conversationId: conversationId))
        guard FileManager.default.fileExists(atPath: path.path) else { return [] }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        return try JSONDecoder().decode([MessageRecord].self, from: data)
    }

    func saveMessages(conversationId: String, messages: [MessageRecord]) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.messagesPath(conversationId: conversationId))
        let data = try JSONEncoder().encode(messages)
        try data.write(to: path, options: .atomic)
        markEdited()
    }

    @discardableResult
    func createConversation() throws -> String {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let id = generateId(prefix: "conv")
        var map = try loadConversationMapRaw()
        map[id] = ConversationMeta(title: nil, createdAt: Int64(Date().timeIntervalSince1970 * 1000), sessionKind: "chat")
        try saveConversationMap(map)
        try saveMessages(conversationId: id, messages: [])
        try reload()
        return id
    }

    func patchConversationMeta(
        conversationId: String,
        title: String? = nil,
        titleSource: String? = nil
    ) throws {
        var map = try loadConversationMapRaw()
        guard var meta = map[conversationId] else { return }
        if meta.titleSource == "user" || meta.titleSource == "imported" { return }
        if let title { meta.title = title }
        if let titleSource { meta.titleSource = titleSource }
        map[conversationId] = meta
        try saveConversationMap(map)
        try reload()
    }

    func setProvisionalTitleIfNeeded(conversationId: String, fromUserMessage content: String) throws {
        var map = try loadConversationMapRaw()
        guard var meta = map[conversationId] else { return }
        if meta.titleSource == "user" || meta.titleSource == "imported" { return }
        let existing = meta.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !existing.isEmpty, !ConversationTitlePolicy.isTimePlaceholderTitle(meta.title) { return }
        guard let provisional = ConversationTitlePolicy.provisionalTitle(from: content) else { return }
        meta.title = provisional
        meta.titleSource = "auto"
        map[conversationId] = meta
        try saveConversationMap(map)
        try reload()
    }

    func appendMessage(
        conversationId: String,
        role: MessageRole,
        content: String,
        model: String? = nil
    ) throws {
        var messages = try loadMessages(conversationId: conversationId)
        messages.append(MessageRecord(
            role: role.rawValue,
            content: content,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            model: model
        ))
        try saveMessages(conversationId: conversationId, messages: messages)
        if role == .user {
            try setProvisionalTitleIfNeeded(conversationId: conversationId, fromUserMessage: content)
        }
        if role == .assistant {
            var map = try loadConversationMapRaw()
            if var meta = map[conversationId] {
                meta.hasAssistantReply = true
                map[conversationId] = meta
                try saveConversationMap(map)
            }
        }
        try reload()
    }

    func loadUserMemory() throws -> [String: String] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.userMemoryFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return [:] }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        return try JSONDecoder().decode([String: String].self, from: data)
    }

    func loadSettingsOpenAIKey() throws -> String? {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let openai = json["openai"] as? [String: Any],
              let key = openai["apiKey"] as? String,
              !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return key
    }

    func loadMemoryInjectionStrategy() throws -> MemoryInjectionStrategy {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return .all }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let memory = json["memory"] as? [String: Any],
              let raw = memory["injectionStrategy"] as? String
        else { return .all }
        return MemoryInjectionStrategy.parse(raw)
    }

    func markSynced(revision: String) {
        hasLocalEdits = false
        UserDefaults.standard.set(revision, forKey: SyncEngine.lastSyncedRevisionKey)
    }

    func markEdited() {
        hasLocalEdits = true
    }

    func clearLocalEditsFlag() {
        hasLocalEdits = false
    }

    func snapshotConversations() throws -> [String: ConversationSnapshot] {
        let map = try loadConversationMapRaw()
        var snapshots: [String: ConversationSnapshot] = [:]
        for (id, meta) in map {
            let messageCount = (try? loadMessages(conversationId: id).count) ?? 0
            snapshots[id] = ConversationSnapshot(
                id: id,
                title: meta.title,
                createdAt: meta.createdAt,
                hasAssistantReply: meta.hasAssistantReply ?? false,
                messageCount: messageCount
            )
        }
        return snapshots
    }

    // MARK: - Private

    private func loadConversationMap() throws -> [String: ConversationMeta] {
        try loadConversationMapRaw()
    }

    private func loadConversationMapRaw() throws -> [String: ConversationMeta] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.conversationsFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return [:] }
        let data: Data
        do {
            data = try LocalDataLayout.readRegularFileData(at: path)
        } catch let error as LocalDataLayoutError {
            throw error
        }
        if data.isEmpty { return [:] }

        do {
            return try JSONDecoder().decode([String: ConversationMeta].self, from: data)
        } catch {
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw LocalDataLayoutError.invalidConversationsFormat(error.localizedDescription)
            }
            var map: [String: ConversationMeta] = [:]
            for (id, value) in json {
                guard let meta = ConversationMeta.fromDesktopJSONObject(value) else { continue }
                map[id] = meta
            }
            if map.isEmpty, !json.isEmpty {
                throw LocalDataLayoutError.invalidConversationsFormat("entries are not conversation objects")
            }
            return map
        }
    }

    private func saveConversationMap(_ map: [String: ConversationMeta]) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.conversationsFile)
        let data = try JSONEncoder().encode(map)
        try data.write(to: path, options: .atomic)
        markEdited()
    }

    private func generateId(prefix: String) -> String {
        let suffix = String(UUID().uuidString.prefix(8).lowercased())
        return "\(prefix)_\(Int64(Date().timeIntervalSince1970 * 1000))_\(suffix)"
    }
}
