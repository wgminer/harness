import Foundation

enum SyncEngineError: LocalizedError {
    case noBackupFolder
    case iCloudPlaceholder(String)
    case conflict
    case bundleHashMismatch
    case manifestMissing

    var errorDescription: String? {
        switch self {
        case .noBackupFolder:
            return "Choose your Harness backup folder in Settings (same folder as desktop Sync)."
        case .iCloudPlaceholder(let name):
            return "Waiting for iCloud to download \(name). Open Files and wait for the download to finish."
        case .conflict:
            return "Desktop and phone both changed since the last sync."
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
        case conflict
    }

    let kind: Kind
    let message: String
    let detail: String?
    let conflictContext: SyncConflictContext?

    init(
        kind: Kind,
        message: String,
        detail: String? = nil,
        conflictContext: SyncConflictContext? = nil
    ) {
        self.kind = kind
        self.message = message
        self.detail = detail
        self.conflictContext = conflictContext
    }
}

@MainActor
final class SyncEngine {
    static let lastSyncedRevisionKey = "harness.lastSyncedRevision"

    let localDataDir: URL
    weak var store: ConversationStore?

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    var lastSyncedRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedRevisionKey)
    }

    func syncNow(forcePull: Bool = false, forcePush: Bool = false) async throws -> SyncOutcome {
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
        let localMaxMtime = try BundleCodec.computeLocalMaxMtime(localDataDir: localDataDir)
        let remoteManifest = try BackupManifest.load(from: manifestURL)
        let beforeSnapshot = try store?.snapshotConversations() ?? [:]
        let conversationCount = beforeSnapshot.count
        let hasLocalEdits = store?.hasLocalEdits ?? false

        if forcePull {
            let fileCount = try await pull(bundleURL: bundleURL, manifestURL: manifestURL)
            let afterSnapshot = try store?.snapshotConversations() ?? [:]
            return SyncOutcome(
                kind: .pulled,
                message: "Downloaded from backup folder",
                detail: SyncChangeSummary.describePullChanges(
                    before: beforeSnapshot,
                    after: afterSnapshot,
                    fileCount: fileCount
                )
            )
        }
        if forcePush {
            let fileCount = try await push(bundleURL: bundleURL, manifestURL: manifestURL, localRevision: localRevision)
            return SyncOutcome(
                kind: .pushed,
                message: "Uploaded to backup folder",
                detail: SyncChangeSummary.describePush(
                    fileCount: fileCount,
                    conversationCount: conversationCount
                )
            )
        }

        let decision = SyncDecisionEngine.decide(params: (
            localRevision: localRevision,
            remoteRevision: remoteManifest?.revision,
            lastSyncedRevision: lastSyncedRevision,
            remoteUpdatedAt: remoteManifest?.updatedAt,
            localMaxMtimeMs: localMaxMtime
        ))

        switch decision {
        case .noop:
            store?.markSynced(revision: localRevision)
            return SyncOutcome(
                kind: .noop,
                message: "Already up to date",
                detail: SyncChangeSummary.describeNoop(
                    hasLocalEdits: hasLocalEdits,
                    conversationCount: conversationCount
                )
            )
        case .pull:
            let fileCount = try await pull(bundleURL: bundleURL, manifestURL: manifestURL)
            let afterSnapshot = try store?.snapshotConversations() ?? [:]
            return SyncOutcome(
                kind: .pulled,
                message: "Downloaded from backup folder",
                detail: SyncChangeSummary.describePullChanges(
                    before: beforeSnapshot,
                    after: afterSnapshot,
                    fileCount: fileCount
                )
            )
        case .push:
            let fileCount = try await push(bundleURL: bundleURL, manifestURL: manifestURL, localRevision: localRevision)
            return SyncOutcome(
                kind: .pushed,
                message: "Uploaded to backup folder",
                detail: SyncChangeSummary.describePush(
                    fileCount: fileCount,
                    conversationCount: conversationCount
                )
            )
        case .conflict:
            return SyncOutcome(
                kind: .conflict,
                message: "Sync conflict",
                detail: SyncEngineError.conflict.errorDescription,
                conflictContext: SyncConflictContext.make(
                    localRevision: localRevision,
                    remoteRevision: remoteManifest?.revision,
                    lastSyncedRevision: lastSyncedRevision,
                    remoteUpdatedAtMs: remoteManifest?.updatedAt,
                    hasLocalEdits: hasLocalEdits,
                    conversationCount: conversationCount
                )
            )
        }
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
        let revision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackData: BundleCodec.entryDataMap(from: doc)
        )
        UserDefaults.standard.set(revision, forKey: Self.lastSyncedRevisionKey)
        store?.clearLocalEditsFlag()
        try store?.reload()
        return fileCount
    }

    private func push(bundleURL: URL, manifestURL: URL, localRevision: String) async throws -> Int {
        let remoteBundleData = try loadRemoteBundleData(bundleURL: bundleURL)
        let built = try BundleCodec.buildBundle(
            localDataDir: localDataDir,
            scopes: SyncScopes.mobilePushScopes,
            passthroughData: remoteBundleData
        )
        try BundleCodec.atomicWrite(built.bytes, to: bundleURL)
        let manifest = BackupManifest(
            version: SyncScopes.manifestVersion,
            revision: localRevision,
            contentRevision: nil,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            bundleHash: built.bundleHash
        )
        try manifest.save(to: manifestURL)
        UserDefaults.standard.set(localRevision, forKey: Self.lastSyncedRevisionKey)
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
