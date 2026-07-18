import Foundation

enum LocalDataLayout {
    static let appStateDir = "app-state"
    static let conversationsFile = "app-state/conversations.json"
    static let notesIndexFile = "app-state/notes.json"
    static let userMemoryFile = "app-state/user_memory.json"
    static let tasksFile = "app-state/tasks.json"
    static let settingsFile = "settings/settings.json"

    static func noteFile(id: String) -> String {
        "app-state/notes/\(id).md"
    }

    static func messagesPath(conversationId: String) -> String {
        let safe = conversationId.replacingOccurrences(
            of: "[^a-zA-Z0-9_-]",
            with: "_",
            options: .regularExpression
        )
        return "app-state/messages_\(safe).json"
    }

    static func chatAttachmentPath(conversationId: String, attachmentId: String) -> String {
        let safeConversation = conversationId.replacingOccurrences(
            of: "[^a-zA-Z0-9_-]",
            with: "_",
            options: .regularExpression
        )
        let safeAttachment = attachmentId.replacingOccurrences(
            of: "[^a-zA-Z0-9_-]",
            with: "_",
            options: .regularExpression
        )
        return "app-state/chat-attachments/\(safeConversation)/\(safeAttachment).jpg"
    }

    /// Resolve a posix-style path under `local-data/` (e.g. `app-state/conversations.json`).
    static func fileURL(in localDataDir: URL, relativePath: String) -> URL {
        relativePath.split(separator: "/").reduce(localDataDir) { url, component in
            url.appendingPathComponent(String(component), isDirectory: false)
        }
    }

    /// Relative path from `base` to `file`, normalizing `/private/var` vs `/var` prefixes.
    static func relativePath(from base: URL, to file: URL) -> String? {
        let basePath = normalizeFilePath(base.path)
        let filePath = normalizeFilePath(file.path)
        let prefix = basePath + "/"
        guard filePath.hasPrefix(prefix) else { return nil }
        return String(filePath.dropFirst(prefix.count))
    }

    static func ensureDirectories(at localDataDir: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: fileURL(in: localDataDir, relativePath: appStateDir), withIntermediateDirectories: true)
        try fm.createDirectory(at: fileURL(in: localDataDir, relativePath: "app-state/notes"), withIntermediateDirectories: true)
        try fm.createDirectory(at: fileURL(in: localDataDir, relativePath: "app-state/chat-attachments"), withIntermediateDirectories: true)
        try fm.createDirectory(at: fileURL(in: localDataDir, relativePath: "settings"), withIntermediateDirectories: true)
    }

    /// Desktop expects `{}` when no chats exist; create it so reads never fail on a missing file.
    static func ensureConversationsFile(at localDataDir: URL) throws {
        try ensureDirectories(at: localDataDir)
        let url = fileURL(in: localDataDir, relativePath: conversationsFile)
        guard !FileManager.default.fileExists(atPath: url.path) else { return }
        try Data("{}".utf8).write(to: url, options: .atomic)
    }

    static func readRegularFileData(at url: URL) throws -> Data {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            throw LocalDataLayoutError.missingFile(url.lastPathComponent)
        }
        guard !isDirectory.boolValue else {
            throw LocalDataLayoutError.unreadableFile(url.lastPathComponent)
        }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        if values.isRegularFile == false {
            throw LocalDataLayoutError.unreadableFile(url.lastPathComponent)
        }
        if values.fileSize == 0 {
            throw LocalDataLayoutError.unreadableFile(url.lastPathComponent)
        }
        return try Data(contentsOf: url)
    }

    private static func normalizeFilePath(_ path: String) -> String {
        let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
        if standardized.hasPrefix("/private/var/") {
            return "/var/" + standardized.dropFirst("/private/var/".count)
        }
        if standardized.hasPrefix("/private/") {
            return String(standardized.dropFirst("/private".count))
        }
        return standardized
    }
}

enum LocalDataLayoutError: LocalizedError {
    case missingFile(String)
    case unreadableFile(String)
    case invalidConversationsFormat(String)

    var errorDescription: String? {
        switch self {
        case .missingFile(let name):
            return "Could not find \(name). Try syncing from your Mac backup folder."
        case .unreadableFile(let name):
            return "\(name) is not available yet. If it is in iCloud, open Files and wait for the download to finish."
        case .invalidConversationsFormat(let detail):
            return "conversations.json is not valid Harness data (\(detail))."
        }
    }
}
