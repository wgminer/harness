import Foundation

@MainActor
final class ClippingsStore: ObservableObject {
    @Published private(set) var clippings: [ClippingItem] = []

    let localDataDir: URL
    private weak var conversationStore: ConversationStore?

    init(localDataDir: URL, conversationStore: ConversationStore) {
        self.localDataDir = localDataDir
        self.conversationStore = conversationStore
    }

    func reload() throws {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.clippingsFile)
        guard FileManager.default.fileExists(atPath: path.path) else {
            clippings = []
            return
        }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            clippings = []
            return
        }
        let rows = object["clippings"] as? [Any] ?? []
        clippings = rows.compactMap { row -> ClippingItem? in
            guard let dict = row as? [String: Any] else { return nil }
            return ClippingItem.fromDesktopJSONObject(dict)
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    @discardableResult
    func create(content: String, tags: [String] = []) throws -> ClippingItem {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ClippingsStoreError.emptyContent }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let item = ClippingItem(
            id: generateId(prefix: "clip"),
            kind: .text,
            content: trimmed,
            tags: normalizeClippingTags(tags),
            createdAt: now,
            updatedAt: now
        )
        var next = clippings
        next.insert(item, at: 0)
        try save(next)
        return item
    }

    func update(id: String, content: String?, tags: [String]?) throws {
        guard let index = clippings.firstIndex(where: { $0.id == id }) else {
            throw ClippingsStoreError.notFound
        }
        var item = clippings[index]
        if let content {
            let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw ClippingsStoreError.emptyContent }
            item.content = trimmed
        }
        if let tags {
            item.tags = normalizeClippingTags(tags)
        }
        item.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        var next = clippings
        next[index] = item
        try save(next)
    }

    func delete(id: String) throws {
        let next = clippings.filter { $0.id != id }
        guard next.count != clippings.count else { throw ClippingsStoreError.notFound }
        try save(next)
    }

    var allTags: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for item in clippings {
            for tag in item.tags where !seen.contains(tag) {
                seen.insert(tag)
                out.append(tag)
            }
        }
        return out.sorted()
    }

    private func save(_ items: [ClippingItem]) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.clippingsFile)
        let state = ClippingsState(clippings: items)
        let data = try JSONEncoder().encode(state)
        try data.write(to: path, options: .atomic)
        clippings = items.sorted { $0.updatedAt > $1.updatedAt }
        conversationStore?.markEdited()
    }

    private func generateId(prefix: String) -> String {
        let suffix = String(UUID().uuidString.prefix(8).lowercased())
        return "\(prefix)_\(Int64(Date().timeIntervalSince1970 * 1000))_\(suffix)"
    }
}

enum ClippingsStoreError: LocalizedError {
    case emptyContent
    case notFound

    var errorDescription: String? {
        switch self {
        case .emptyContent:
            return "Clipping content cannot be empty."
        case .notFound:
            return "Clipping not found."
        }
    }
}
