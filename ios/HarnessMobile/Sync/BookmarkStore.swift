import Foundation

enum BookmarkStore {
    private static let bookmarkKey = "harness.backupFolderBookmark"

    static var hasBookmark: Bool {
        UserDefaults.standard.data(forKey: bookmarkKey) != nil
    }

    static func saveBookmark(from url: URL) throws {
        let data = try url.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        UserDefaults.standard.set(data, forKey: bookmarkKey)
        UserDefaults.standard.set(url.path, forKey: "harness.backupFolderPathDisplay")
    }

    static func resolveFolderURL() throws -> URL {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else {
            throw SyncEngineError.noBackupFolder
        }
        var stale = false
        let url = try URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
        if stale {
            try saveBookmark(from: url)
        }
        return url
    }

    static var displayPath: String? {
        UserDefaults.standard.string(forKey: "harness.backupFolderPathDisplay")
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        UserDefaults.standard.removeObject(forKey: "harness.backupFolderPathDisplay")
    }
}
