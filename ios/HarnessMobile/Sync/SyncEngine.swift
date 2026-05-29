import Foundation

enum SyncEngineError: LocalizedError {
    case noBackupFolder
    case iCloudPlaceholder(String)
    case bundleHashMismatch
    case manifestMissing

    var errorDescription: String? {
        switch self {
        case .noBackupFolder:
            return "Choose your Harness backup folder in Settings (same folder as desktop Sync)."
        case .iCloudPlaceholder(let name):
            return "Waiting for iCloud to download \(name). Open Files and wait for the download to finish."
        case .bundleHashMismatch:
            return "Backup bundle failed integrity check."
        case .manifestMissing:
            return "No manifest in backup folder. Sync from desktop Harness first."
        }
    }
}

struct SyncOutcome: Equatable {
    enum Kind: Equatable {
        case noop
        case pulled
        case pushed
    }

    let kind: Kind
}

@MainActor
final class SyncEngine {
    static let lastSyncedRevisionKey = "harness.lastSyncedRevision"
    static let lastSyncedContentRevisionKey = "harness.lastSyncedContentRevision"

    let localDataDir: URL
    weak var store: ConversationStore?

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    var lastSyncedRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedRevisionKey)
    }

    func syncNow(forcePull: Bool = false) async throws -> SyncOutcome {
        let backupFolder = try BookmarkStore.resolveFolderURL()
        _ = backupFolder.startAccessingSecurityScopedResource()
        defer { backupFolder.stopAccessingSecurityScopedResource() }

        let bundleURL = backupFolder.appendingPathComponent(SyncScopes.bundleFileName)
        let manifestURL = backupFolder.appendingPathComponent(SyncScopes.manifestFileName)

        try checkPlaceholder(in: backupFolder, filename: SyncScopes.bundleFileName)
        try pruneNonMaterializedFiles()

        let remoteBundleData = try loadRemoteBundleData(bundleURL: bundleURL)
        let localRevision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackData: remoteBundleData
        )
        let localContentRevision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            scopes: SyncScopes.userContentScopes,
            fallbackData: remoteBundleData
        )
        let localMaxMtime = try BundleCodec.computeLocalMaxMtime(
            localDataDir: localDataDir,
            scopes: SyncScopes.userContentScopes
        )
        let remoteManifest = try BackupManifest.load(from: manifestURL)

        if forcePull {
            _ = try await pull(bundleURL: bundleURL, manifestURL: manifestURL)
            return SyncOutcome(kind: .pulled)
        }

        guard let remoteManifest else {
            _ = try await push(
                bundleURL: bundleURL,
                manifestURL: manifestURL,
                localRevision: localRevision,
                localContentRevision: localContentRevision
            )
            return SyncOutcome(kind: .pushed)
        }

        let remoteContentRevision = try remoteContentRevision(
            manifest: remoteManifest,
            bundleURL: bundleURL
        )
        let decision = SyncDecisionEngine.resolve(params: (
            localRevision: localRevision,
            localContentRevision: localContentRevision,
            remoteRevision: remoteManifest.revision,
            remoteContentRevision: remoteContentRevision,
            lastSyncedRevision: lastSyncedRevision,
            lastSyncedContentRevision: lastSyncedContentRevision,
            remoteUpdatedAt: remoteManifest.updatedAt,
            localMaxMtimeMs: localMaxMtime
        ))

        switch decision {
        case .noop:
            recordSyncedRevisions(revision: localRevision, contentRevision: localContentRevision)
            store?.markSynced(revision: localRevision)
            return SyncOutcome(kind: .noop)
        case .pull:
            _ = try await pull(bundleURL: bundleURL, manifestURL: manifestURL)
            return SyncOutcome(kind: .pulled)
        case .push:
            _ = try await push(
                bundleURL: bundleURL,
                manifestURL: manifestURL,
                localRevision: localRevision,
                localContentRevision: localContentRevision
            )
            return SyncOutcome(kind: .pushed)
        case .conflict:
            _ = try await merge(bundleURL: bundleURL, manifestURL: manifestURL)
            return SyncOutcome(kind: .pushed)
        }
    }

    private var lastSyncedContentRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedContentRevisionKey)
    }

    private func recordSyncedRevisions(revision: String, contentRevision: String) {
        UserDefaults.standard.set(revision, forKey: Self.lastSyncedRevisionKey)
        UserDefaults.standard.set(contentRevision, forKey: Self.lastSyncedContentRevisionKey)
    }

    private func remoteContentRevision(manifest: BackupManifest, bundleURL: URL) throws -> String {
        if let contentRevision = manifest.contentRevision, !contentRevision.isEmpty {
            return contentRevision
        }
        guard FileManager.default.fileExists(atPath: bundleURL.path) else { return "" }
        let bytes = try Data(contentsOf: bundleURL)
        let doc = try BundleCodec.parseBundle(bytes)
        return BundleCodec.computeContentRevisionFromBundle(doc)
    }

    private func pull(bundleURL: URL, manifestURL: URL) async throws -> Int {
        guard FileManager.default.fileExists(atPath: bundleURL.path) else {
            throw SyncEngineError.manifestMissing
        }
        let bytes = try Data(contentsOf: bundleURL)
        let manifest = try BackupManifest.load(from: manifestURL)
        if let manifest, BundleCodec.hashBundleBytes(bytes) != manifest.bundleHash {
            throw SyncEngineError.bundleHashMismatch
        }
        let doc = try BundleCodec.parseBundle(bytes)
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let fileCount = try BundleCodec.extractBundle(localDataDir: localDataDir, doc: doc)
        try pruneNonMaterializedFiles()
        let contentRevision: String
        if let manifest {
            contentRevision = try remoteContentRevision(manifest: manifest, bundleURL: bundleURL)
        } else {
            contentRevision = BundleCodec.computeContentRevisionFromBundle(doc)
        }
        let revision = try manifest?.revision ?? BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackData: BundleCodec.entryDataMap(from: doc)
        )
        recordSyncedRevisions(revision: revision, contentRevision: contentRevision)
        store?.clearLocalEditsFlag()
        try store?.reload()
        return fileCount
    }

    private struct MergeResult {
        let fileCount: Int
        let afterSnapshot: [String: ConversationSnapshot]
        let mergeWarning: String?
    }

    private func merge(bundleURL: URL, manifestURL: URL) async throws -> MergeResult {
        guard FileManager.default.fileExists(atPath: bundleURL.path) else {
            throw SyncEngineError.manifestMissing
        }
        let remoteManifest = try BackupManifest.load(from: manifestURL)
        guard remoteManifest != nil else { throw SyncEngineError.manifestMissing }

        let localFiles = try loadLocalScopedFileMap()
        let remoteFiles = try loadRemoteBundleData(bundleURL: bundleURL)
        let review = SyncMerge.buildConflictReview(localFiles: localFiles, remoteFiles: remoteFiles)
        let choices = SyncMerge.buildDefaultMergeChoices(review: review)
        let mergeWarning = SyncMerge.mergeWarning(from: review)
        let mergedFiles = SyncMerge.buildMergedFileMap(
            localFiles: localFiles,
            remoteFiles: remoteFiles,
            choices: choices
        )

        try applyMergedFiles(mergedFiles)
        try pruneNonMaterializedFiles()

        var passthrough: [String: Data] = [:]
        for (path, data) in mergedFiles where !SyncScopes.materializesLocally(path) {
            passthrough[path] = data
        }

        let localRevision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackData: mergedFiles
        )
        let localContentRevision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            scopes: SyncScopes.userContentScopes,
            fallbackData: mergedFiles
        )
        let fileCount = try await push(
            bundleURL: bundleURL,
            manifestURL: manifestURL,
            localRevision: localRevision,
            localContentRevision: localContentRevision,
            extraPassthrough: passthrough
        )
        let afterSnapshot = try store?.snapshotConversations() ?? [:]
        return MergeResult(fileCount: fileCount, afterSnapshot: afterSnapshot, mergeWarning: mergeWarning)
    }

    private func push(
        bundleURL: URL,
        manifestURL: URL,
        localRevision: String,
        localContentRevision: String,
        extraPassthrough: [String: Data] = [:]
    ) async throws -> Int {
        var passthroughData = try loadRemoteBundleData(bundleURL: bundleURL)
        for (path, data) in extraPassthrough {
            passthroughData[path] = data
        }
        let built = try BundleCodec.buildBundle(
            localDataDir: localDataDir,
            scopes: SyncScopes.mobilePushScopes,
            passthroughData: passthroughData
        )
        try BundleCodec.atomicWrite(built.bytes, to: bundleURL)
        let manifest = BackupManifest(
            version: SyncScopes.manifestVersion,
            revision: localRevision,
            contentRevision: localContentRevision,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            bundleHash: built.bundleHash
        )
        try manifest.save(to: manifestURL)
        recordSyncedRevisions(revision: localRevision, contentRevision: localContentRevision)
        store?.markSynced(revision: localRevision)
        return built.entries.count
    }

    private func checkPlaceholder(in folder: URL, filename: String) throws {
        let placeholder = folder.appendingPathComponent(SyncScopes.placeholderSibling(for: filename))
        if FileManager.default.fileExists(atPath: placeholder.path) {
            throw SyncEngineError.iCloudPlaceholder(filename)
        }
        let target = folder.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: target.path) {
            let attrs = try FileManager.default.attributesOfItem(atPath: target.path)
            if let size = attrs[.size] as? Int, size == 0 {
                throw SyncEngineError.iCloudPlaceholder(filename)
            }
        }
    }

    private func loadLocalScopedFileMap() throws -> [String: Data] {
        let files = try BundleCodec.listScopedFiles(
            localDataDir: localDataDir,
            scopes: SyncScopes.defaultScopes
        )
        var map: [String: Data] = [:]
        for rel in files {
            let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
            if let data = try? LocalDataLayout.readRegularFileData(at: url) {
                map[rel] = data
            }
        }
        return map
    }

    private func applyMergedFiles(_ merged: [String: Data]) throws {
        let fm = FileManager.default
        let scopes = SyncScopes.defaultScopes
        let existing = try BundleCodec.listScopedFiles(localDataDir: localDataDir, scopes: scopes)

        for (rel, data) in merged {
            guard SyncScopes.isInScope(rel, scopes: scopes), SyncScopes.materializesLocally(rel) else { continue }
            let abs = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
            try fm.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: abs, options: .atomic)
        }

        for rel in existing {
            guard SyncScopes.materializesLocally(rel) else { continue }
            if merged[rel] == nil {
                let abs = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
                if fm.fileExists(atPath: abs.path) {
                    try fm.removeItem(at: abs)
                }
            }
        }
        store?.markEdited()
    }

    private func loadRemoteBundleData(bundleURL: URL) throws -> [String: Data] {
        guard FileManager.default.fileExists(atPath: bundleURL.path) else { return [:] }
        let bytes = try Data(contentsOf: bundleURL)
        let doc = try BundleCodec.parseBundle(bytes)
        return BundleCodec.entryDataMap(from: doc)
    }

    private func pruneNonMaterializedFiles() throws {
        let appState = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.appStateDir)
        let fm = FileManager.default
        guard fm.fileExists(atPath: appState.path) else { return }

        let writing = appState.appendingPathComponent("writing.md")
        if fm.fileExists(atPath: writing.path) {
            try fm.removeItem(at: writing)
        }

        let notesDir = appState.appendingPathComponent("notes", isDirectory: true)
        guard fm.fileExists(atPath: notesDir.path) else { return }
        if let entries = try? fm.contentsOfDirectory(at: notesDir, includingPropertiesForKeys: nil) {
            for url in entries where url.pathExtension == "md" {
                try? fm.removeItem(at: url)
            }
        }
        if (try? fm.contentsOfDirectory(atPath: notesDir.path))?.isEmpty == true {
            try? fm.removeItem(at: notesDir)
        }
    }
}
