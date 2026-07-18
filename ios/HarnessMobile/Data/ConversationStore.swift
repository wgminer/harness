import Foundation

@MainActor
final class ConversationStore: ObservableObject {
    @Published private(set) var conversations: [ConversationListItem] = []
    @Published private(set) var hasLocalEdits = false

    /// Fired after local synced content is written (not after sync pulls).
    var onContentChanged: (() -> Void)?

    let localDataDir: URL

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    func reload() throws {
        let map = try loadConversationMapRaw()
        conversations = Self.sidebarItems(from: map) { id in
            Self.sidebarMessageProbe(localDataDir: localDataDir, conversationId: id)
        }
    }

    /// Off-main sidebar rebuild for sync / refresh paths that must not hitch the UI.
    func reloadAsync() async throws {
        let dir = localDataDir
        let items = try await Task.detached(priority: .userInitiated) {
            let map = try Self.loadConversationMapRaw(localDataDir: dir)
            return Self.sidebarItems(from: map) { id in
                Self.sidebarMessageProbe(localDataDir: dir, conversationId: id)
            }
        }.value
        conversations = items
    }

    /// Single-pass bootstrap: optionally prune empties / backfill `hasMessages`, then publish sidebar.
    func loadSidebarConversations(pruningEmpty: Bool) throws {
        var map = try loadConversationMapRaw()
        if pruningEmpty {
            map = try pruneMapInPlace(map)
        }
        conversations = Self.sidebarItems(from: map) { id in
            Self.sidebarMessageProbe(localDataDir: localDataDir, conversationId: id)
        }
    }

    /// Deletes message-less conversations and backfills `hasMessages` for existing threads.
    @discardableResult
    func pruneEmptyConversations() throws -> Int {
        let before = try loadConversationMapRaw()
        let after = try pruneMapInPlace(before)
        return before.count - after.count
    }

    /// Disk-only sidebar load for off-main bootstrap. Returns items and whether the map was rewritten.
    nonisolated static func bootstrapSidebar(
        localDataDir: URL,
        pruningEmpty: Bool
    ) throws -> (conversations: [ConversationListItem], removedEmptyCount: Int) {
        var map = try loadConversationMapRaw(localDataDir: localDataDir)
        var removed = 0
        if pruningEmpty {
            let result = try pruneConversationMap(map, localDataDir: localDataDir)
            map = result.map
            removed = result.removed
            if result.changed {
                try saveConversationMap(map, localDataDir: localDataDir)
            }
        }
        let items = sidebarItems(from: map) { id in
            Self.sidebarMessageProbe(localDataDir: localDataDir, conversationId: id)
        }
        return (items, removed)
    }

    func applyBootstrapConversations(_ items: [ConversationListItem]) {
        conversations = items
    }

    private func pruneMapInPlace(_ map: [String: ConversationMeta]) throws -> [String: ConversationMeta] {
        let result = try Self.pruneConversationMap(map, localDataDir: localDataDir)
        if result.changed {
            try saveConversationMap(result.map)
        }
        return result.map
    }

    private nonisolated static func pruneConversationMap(
        _ map: [String: ConversationMeta],
        localDataDir: URL
    ) throws -> (map: [String: ConversationMeta], changed: Bool, removed: Int) {
        var map = map
        var removed = 0
        var changed = false

        for (id, meta) in map {
            if meta.hasMessages == true {
                continue
            }
            let messages = try loadMessages(localDataDir: localDataDir, conversationId: id)
            if messages.isEmpty {
                map.removeValue(forKey: id)
                let messagesPath = LocalDataLayout.fileURL(
                    in: localDataDir,
                    relativePath: LocalDataLayout.messagesPath(conversationId: id)
                )
                if FileManager.default.fileExists(atPath: messagesPath.path) {
                    try? FileManager.default.removeItem(at: messagesPath)
                }
                DictationRecordingIndex.unlink(conversationId: id)
                removed += 1
                changed = true
                continue
            }
            if meta.hasMessages != true {
                var updated = meta
                updated.hasMessages = true
                map[id] = updated
                changed = true
            }
        }

        return (map, changed, removed)
    }

    private nonisolated static func sidebarItems(
        from map: [String: ConversationMeta],
        messageCount: (String) -> Int
    ) -> [ConversationListItem] {
        map
            .compactMap { id, meta -> ConversationListItem? in
                if meta.hasMessages == true {
                    return ConversationListItem(
                        id: id,
                        title: meta.title,
                        createdAt: meta.createdAt,
                        hasAssistantReply: meta.hasAssistantReply ?? false,
                        hasMessages: true
                    )
                }
                let count = messageCount(id)
                guard ConversationListItem.isSidebarVisible(meta: meta, messageCount: count) else {
                    return nil
                }
                return ConversationListItem(
                    id: id,
                    title: meta.title,
                    createdAt: meta.createdAt,
                    hasAssistantReply: meta.hasAssistantReply ?? false,
                    hasMessages: count > 0
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func loadConversationMeta(conversationId: String) throws -> ConversationMeta? {
        try loadConversationMapRaw()[conversationId]
    }

    func loadMessages(conversationId: String) throws -> [MessageRecord] {
        try Self.loadMessages(localDataDir: localDataDir, conversationId: conversationId)
    }

    nonisolated static func loadMessages(localDataDir: URL, conversationId: String) throws -> [MessageRecord] {
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
        notifyContentChanged()
    }

    @discardableResult
    func createConversation() throws -> String {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let id = generateId(prefix: "conv")
        var map = try loadConversationMapRaw()
        map[id] = ConversationMeta(title: nil, createdAt: Int64(Date().timeIntervalSince1970 * 1000), sessionKind: "chat")
        try saveConversationMap(map)
        try saveMessages(conversationId: id, messages: [])
        // Empty chats stay off the sidebar until they have messages — skip full reload.
        return id
    }

    /// Creates a dictation session with the transcribed user message already stored.
    @discardableResult
    func createDictationConversation(userMessage: String, recordingURL: URL? = nil) throws -> String {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let id = generateId(prefix: "conv")
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let title = ConversationTitlePolicy.voiceDictationTitle()
        let meta = ConversationMeta(
            title: title,
            createdAt: now,
            sessionKind: "dictation",
            hasAssistantReply: false,
            hasMessages: true,
            titleSource: "auto"
        )
        var map = try loadConversationMapRaw()
        map[id] = meta
        try saveConversationMap(map)
        let record = MessageRecord(
            role: MessageRole.user.rawValue,
            content: userMessage,
            timestamp: now,
            model: nil
        )
        try saveMessages(conversationId: id, messages: [record])
        if let recordingURL {
            try DictationRecordingIndex.link(conversationId: id, recordingURL: recordingURL)
        }
        upsertSidebarItem(
            conversationId: id,
            meta: meta,
            hasMessages: true
        )
        return id
    }

    func popLastUserMessage(conversationId: String) throws -> String? {
        var messages = try loadMessages(conversationId: conversationId)
        guard let last = messages.last, last.messageRole == .user else { return nil }
        let content = last.content
        messages.removeLast()
        try saveMessages(conversationId: conversationId, messages: messages)
        try reload()
        return content
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
        upsertSidebarItem(
            conversationId: conversationId,
            meta: meta,
            hasMessages: meta.hasMessages == true
        )
    }

    func saveChatImageAttachment(conversationId: String, jpegData: Data) throws -> MessageAttachment {
        let attachmentId = UUID().uuidString.lowercased()
        let relativePath = LocalDataLayout.chatAttachmentPath(
            conversationId: conversationId,
            attachmentId: attachmentId
        )
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: relativePath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try jpegData.write(to: url, options: .atomic)
        return MessageAttachment(id: attachmentId, mimeType: "image/jpeg", relativePath: relativePath)
    }

    func appendMessage(
        conversationId: String,
        role: MessageRole,
        content: String,
        model: String? = nil,
        toolCalls: [ToolCallRecord]? = nil,
        attachments: [MessageAttachment]? = nil
    ) throws {
        var messages = try loadMessages(conversationId: conversationId)
        messages.append(MessageRecord(
            role: role.rawValue,
            content: content,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            model: model,
            toolCalls: toolCalls,
            attachments: attachments
        ))
        try saveMessages(conversationId: conversationId, messages: messages)
        var map = try loadConversationMapRaw()
        guard var meta = map[conversationId] else { return }
        var mapDirty = false
        if meta.hasMessages != true {
            meta.hasMessages = true
            mapDirty = true
        }
        if role == .assistant, meta.hasAssistantReply != true {
            meta.hasAssistantReply = true
            mapDirty = true
        }
        if mapDirty {
            map[conversationId] = meta
            try saveConversationMap(map)
        }
        upsertSidebarItem(conversationId: conversationId, meta: meta, hasMessages: true)
    }

    func loadUserMemory() throws -> [String: String] {
        try Self.loadUserMemory(in: localDataDir)
    }

    func setUserMemoryFact(args: [String: Any]) throws -> MemoryFactsPayload {
        let key = (args["key"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let value = (args["value"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var memory = try Self.loadUserMemory(in: localDataDir)
        if key.isEmpty {
            return MemoryFactsPayload(lastAction: "set_fact", memory: memory, key: key)
        }
        memory[key] = value
        try Self.saveUserMemory(memory, in: localDataDir)
        notifyContentChanged()
        return MemoryFactsPayload(lastAction: "set_fact", memory: memory, key: key)
    }

    func listUserMemoryFacts() throws -> MemoryFactsPayload {
        let memory = try Self.loadUserMemory(in: localDataDir)
        return MemoryFactsPayload(lastAction: "list_facts", memory: memory, key: nil)
    }

    func loadTavilyApiKey() throws -> String? {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let search = json["search"] as? [String: Any],
              let key = search["tavilyApiKey"] as? String,
              !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return key
    }

    nonisolated static func loadUserMemory(in localDataDir: URL) throws -> [String: String] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.userMemoryFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return [:] }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        var memory: [String: String] = [:]
        for (key, value) in object {
            if let text = value as? String {
                memory[key] = text
            }
        }
        return memory
    }

    nonisolated static func saveUserMemory(_ memory: [String: String], in localDataDir: URL) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.userMemoryFile)
        let data = try JSONSerialization.data(
            withJSONObject: memory,
            options: [.prettyPrinted, .sortedKeys]
        )
        try data.write(to: path, options: .atomic)
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

    func markSynced(revision: String) {
        hasLocalEdits = false
        UserDefaults.standard.set(revision, forKey: SyncEngine.lastSyncedRevisionKey)
        if let snapshot = try? snapshotConversations() {
            PendingSyncTracker.saveBaseline(snapshot)
        }
    }

    func setUserTitle(conversationId: String, title: String) throws {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var map = try loadConversationMapRaw()
        guard var meta = map[conversationId] else { return }
        meta.title = trimmed
        meta.titleSource = "user"
        map[conversationId] = meta
        try saveConversationMap(map)
        upsertSidebarItem(
            conversationId: conversationId,
            meta: meta,
            hasMessages: meta.hasMessages == true
        )
    }

    func deleteConversation(id: String) throws {
        var map = try loadConversationMapRaw()
        guard map.removeValue(forKey: id) != nil else { return }
        try saveConversationMap(map)

        let messagesPath = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.messagesPath(conversationId: id)
        )
        if FileManager.default.fileExists(atPath: messagesPath.path) {
            try? FileManager.default.removeItem(at: messagesPath)
        }
        DictationRecordingIndex.unlink(conversationId: id)
        try reload()
    }

    func clearLocalEditsFlag() {
        hasLocalEdits = false
        if let snapshot = try? snapshotConversations() {
            PendingSyncTracker.saveBaseline(snapshot)
        }
    }

    /// Reconcile the pending-upload flag with the last synced content revision.
    func refreshPendingSyncState() async {
        let dir = localDataDir
        let localRevision: String
        do {
            localRevision = try await Task.detached(priority: .utility) {
                try BundleCodec.computeRevision(
                    localDataDir: dir,
                    scopes: SyncScopes.userContentScopes
                )
            }.value
        } catch {
            return
        }
        guard let lastRevision = UserDefaults.standard.string(forKey: SyncEngine.lastSyncedContentRevisionKey),
              !lastRevision.isEmpty
        else {
            hasLocalEdits = false
            return
        }
        hasLocalEdits = localRevision != lastRevision
    }

    func setHasLocalEditsForPreview(_ value: Bool) {
        hasLocalEdits = value
    }

    func snapshotConversations() throws -> [String: ConversationSnapshot] {
        let map = try loadConversationMapRaw()
        var snapshots: [String: ConversationSnapshot] = [:]
        for (id, meta) in map {
            let messageCount = Self.lightweightMessageCount(localDataDir: localDataDir, conversationId: id)
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

    private func notifyContentChanged() {
        onContentChanged?()
    }

    /// Cheap sidebar visibility probe: avoid decoding full message JSON (and SHA-256 ids).
    nonisolated static func sidebarMessageProbe(localDataDir: URL, conversationId: String) -> Int {
        let path = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.messagesPath(conversationId: conversationId)
        )
        guard FileManager.default.fileExists(atPath: path.path) else { return 0 }
        guard let size = try? FileManager.default.attributesOfItem(atPath: path.path)[.size] as? NSNumber else {
            return 0
        }
        // Empty array encodes as "[]" (2 bytes).
        return size.intValue > 2 ? 1 : 0
    }

    /// Message count without constructing `MessageRecord` (skips per-message SHA-256).
    nonisolated static func lightweightMessageCount(localDataDir: URL, conversationId: String) -> Int {
        let path = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.messagesPath(conversationId: conversationId)
        )
        guard FileManager.default.fileExists(atPath: path.path),
              let data = try? LocalDataLayout.readRegularFileData(at: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [Any]
        else {
            return 0
        }
        return json.count
    }

    // MARK: - Private

    func loadConversationMapRaw() throws -> [String: ConversationMeta] {
        try Self.loadConversationMapRaw(localDataDir: localDataDir)
    }

    nonisolated static func loadConversationMapRaw(localDataDir: URL) throws -> [String: ConversationMeta] {
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
        try Self.saveConversationMap(map, localDataDir: localDataDir)
        notifyContentChanged()
    }

    private nonisolated static func saveConversationMap(_ map: [String: ConversationMeta], localDataDir: URL) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.conversationsFile)
        let data = try JSONEncoder().encode(map)
        try data.write(to: path, options: .atomic)
    }

    private func generateId(prefix: String) -> String {
        let suffix = String(UUID().uuidString.prefix(8).lowercased())
        return "\(prefix)_\(Int64(Date().timeIntervalSince1970 * 1000))_\(suffix)"
    }

    /// Patch a single sidebar row without decoding the full conversation library.
    private func upsertSidebarItem(
        conversationId: String,
        meta: ConversationMeta,
        hasMessages: Bool
    ) {
        let messageCount = hasMessages ? 1 : 0
        guard ConversationListItem.isSidebarVisible(meta: meta, messageCount: messageCount) else {
            conversations.removeAll { $0.id == conversationId }
            return
        }
        let item = ConversationListItem(
            id: conversationId,
            title: meta.title,
            createdAt: meta.createdAt,
            hasAssistantReply: meta.hasAssistantReply ?? false,
            hasMessages: hasMessages
        )
        if let index = conversations.firstIndex(where: { $0.id == conversationId }) {
            conversations[index] = item
        } else {
            conversations.append(item)
        }
        conversations.sort { $0.createdAt > $1.createdAt }
    }
}
