import Foundation

/// Chat attachments created on this phone. Only these are kept in `local-data`; every other
/// attachment in the bundle stays in `PassthroughStore`.
enum LocalAttachmentIndex {
    private static let key = HarnessStorageKeys.localAttachmentPaths
    private static let lock = NSLock()
    private static var cached: Set<String>?

    static func contains(_ relPath: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return load().contains(relPath)
    }

    static func insert(_ relPath: String) {
        lock.lock()
        defer { lock.unlock() }
        var paths = load()
        guard paths.insert(relPath).inserted else { return }
        cached = paths
        UserDefaults.standard.set(paths.sorted(), forKey: key)
    }

    private static func load() -> Set<String> {
        if let cached { return cached }
        let paths = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
        cached = paths
        return paths
    }
}

/// On-disk copy of the remote bundle's files that the phone does not materialize
/// (`SyncScopes.materializesLocally == false`). The bundle is one object, so a push has to
/// re-send them; holding them here means a sync only downloads the bundle when the remote
/// changed, and nothing reads them into memory except one file at a time while pushing.
struct PassthroughStore {
    private struct State: Codable {
        var bundleHash: String
        var paths: [String]
    }

    let root: URL

    init(localDataDir: URL) {
        root = localDataDir.appendingPathExtension("passthrough")
    }

    /// Files are stored at their bundle-relative paths under this directory.
    var filesDir: URL { root.appendingPathComponent("files", isDirectory: true) }
    private var stateURL: URL { root.appendingPathComponent("state.json") }

    /// Hash of the remote bundle these files came from; nil when the store is missing,
    /// incomplete, or mid-update, which forces the next sync to download the bundle.
    func bundleHash() -> String? {
        guard let data = try? Data(contentsOf: stateURL),
              let state = try? JSONDecoder().decode(State.self, from: data)
        else { return nil }
        let fm = FileManager.default
        for path in state.paths {
            let url = LocalDataLayout.fileURL(in: filesDir, relativePath: path)
            guard fm.fileExists(atPath: url.path) else { return nil }
        }
        return state.bundleHash
    }

    func contains(_ relPath: String) -> Bool {
        FileManager.default.fileExists(
            atPath: LocalDataLayout.fileURL(in: filesDir, relativePath: relPath).path
        )
    }

    /// Make the store hold exactly the non-materialized files in `doc`.
    func replace(with doc: BundleDocument, bundleHash: String?) throws {
        var entries: [String: BundleEntry] = [:]
        for entry in doc.entries { entries[entry.path] = entry }
        try replace(paths: Array(entries.keys), bundleHash: bundleHash) { path in
            guard let entry = entries[path],
                  let data = Data(base64Encoded: entry.contents),
                  data.count == entry.size
            else { throw BundleCodecError.malformed }
            return data
        }
    }

    func replace(with files: [String: Data], bundleHash: String?) throws {
        try replace(paths: Array(files.keys), bundleHash: bundleHash) { files[$0] ?? Data() }
    }

    /// After a merge: take the merged note bodies and other relayed text, leaving blobs as they
    /// are. The store stays unmatched until the merged bundle is pushed.
    func applyMergedText(_ merged: [String: Data]) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: stateURL)
        let keep = merged.filter {
            SyncScopes.isInScope($0.key, scopes: SyncScopes.defaultScopes)
                && !SyncScopes.materializesLocally($0.key)
                && !SyncScopes.isPassthroughBlob($0.key)
        }
        for path in try storedPaths() where !SyncScopes.isPassthroughBlob(path) && keep[path] == nil {
            try? fm.removeItem(at: LocalDataLayout.fileURL(in: filesDir, relativePath: path))
        }
        for (path, bytes) in keep {
            let url = LocalDataLayout.fileURL(in: filesDir, relativePath: path)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try bytes.write(to: url, options: .atomic)
        }
    }

    /// Record that the remote bundle now matches the store (after this phone pushed).
    func setBundleHash(_ bundleHash: String) throws {
        try writeState(State(bundleHash: bundleHash, paths: try storedPaths()))
    }

    private func replace(
        paths: [String],
        bundleHash: String?,
        data: (String) throws -> Data
    ) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: filesDir, withIntermediateDirectories: true)
        var excluded = URLResourceValues()
        excluded.isExcludedFromBackup = true
        var rootURL = root
        try? rootURL.setResourceValues(excluded)
        // Invalid until the rewrite finishes, so a crash midway cannot leave a store that
        // claims to match a bundle it only partly holds.
        try? fm.removeItem(at: stateURL)

        let keep = Set(paths.filter {
            SyncScopes.isInScope($0, scopes: SyncScopes.defaultScopes) && !SyncScopes.materializesLocally($0)
        })
        for path in try storedPaths() where !keep.contains(path) {
            try? fm.removeItem(at: LocalDataLayout.fileURL(in: filesDir, relativePath: path))
        }
        for path in keep {
            let bytes = try data(path)
            let url = LocalDataLayout.fileURL(in: filesDir, relativePath: path)
            // Most files are unchanged between bundles; comparing is far cheaper than rewriting.
            if let existing = try? Data(contentsOf: url, options: .mappedIfSafe), existing == bytes {
                continue
            }
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try bytes.write(to: url, options: .atomic)
        }
        if let bundleHash {
            try writeState(State(bundleHash: bundleHash, paths: keep.sorted()))
        }
    }

    private func storedPaths() throws -> [String] {
        try BundleCodec.walkFiles(root: filesDir, base: filesDir)
    }

    private func writeState(_ state: State) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
    }
}
