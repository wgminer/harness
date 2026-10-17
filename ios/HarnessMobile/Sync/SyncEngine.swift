import Foundation
import NIOCore
import SotoCore
import SotoS3

enum SyncEngineError: LocalizedError {
    case notConfigured
    case bundleHashMismatch
    case manifestMissing
    case bundleMissing

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Configure Cloudflare R2 in Settings to sync with desktop Harness."
        case .bundleHashMismatch:
            return "Backup bundle failed integrity check."
        case .manifestMissing:
            return "No manifest in remote backup. Sync from desktop Harness first."
        case .bundleMissing:
            return "No backup bundle in remote storage. Sync from desktop Harness first."
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
    let mergeWarning: String?
    /// True when local conversation/task files were rewritten and stores should reload.
    let localDataChanged: Bool
}

@MainActor
final class SyncEngine {
    static let lastSyncedRevisionKey = HarnessStorageKeys.lastSyncedRevision
    static let lastSyncedContentRevisionKey = HarnessStorageKeys.lastSyncedContentRevision

    let localDataDir: URL
    weak var store: ConversationStore?
    /// One client for the life of the configuration, instead of a new connection pool per sync.
    private var cachedRemote: RemoteBackupStore?

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    var lastSyncedRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedRevisionKey)
    }

    private func remoteStore() throws -> RemoteBackupStore {
        let config = try RemoteBackupStore.currentConfig()
        if let cachedRemote, cachedRemote.config == config { return cachedRemote }
        let remote = RemoteBackupStore(config: config)
        cachedRemote = remote
        return remote
    }

    /// `beforeLocalChange` runs once, just before a pull or merge rewrites local files.
    func syncNow(
        forcePull: Bool = false,
        beforeLocalChange: (() async -> Void)? = nil
    ) async throws -> SyncOutcome {
        let remote = try remoteStore()
        let dir = localDataDir
        let passthrough = PassthroughStore(localDataDir: dir)
        let remoteManifest = try await remote.readManifest()

        // The bundle is only downloaded when it is not the one the passthrough store mirrors.
        var remoteDoc: BundleDocument?
        if let remoteManifest {
            let known = await Task.detached(priority: .userInitiated) { passthrough.bundleHash() }.value
            if forcePull || known != remoteManifest.bundleHash {
                remoteDoc = try await fetchRemoteDoc(
                    remote: remote,
                    manifest: remoteManifest,
                    refreshing: passthrough
                )
            }
        }

        let state = try await Task.detached(priority: .userInitiated) {
            try Self.pruneNonMaterializedFiles(localDataDir: dir, passthrough: passthrough)
            let revisions = try BundleCodec.computeSyncRevisions(
                localDataDir: dir,
                fallbackDir: passthrough.filesDir
            )
            let localMaxMtime = try BundleCodec.computeLocalMaxMtime(
                localDataDir: dir,
                scopes: SyncScopes.userContentScopes
            )
            return (revisions.revision, revisions.contentRevision, localMaxMtime)
        }.value
        let localRevision = state.0
        let localContentRevision = state.1
        let localMaxMtime = state.2

        guard let remoteManifest else {
            try await push(
                remote: remote,
                passthrough: passthrough,
                localRevision: localRevision,
                localContentRevision: localContentRevision,
                previousBundleHash: nil
            )
            return SyncOutcome(kind: .pushed, mergeWarning: nil, localDataChanged: false)
        }

        if forcePull {
            guard let remoteDoc else { throw SyncEngineError.bundleMissing }
            await beforeLocalChange?()
            try await pull(remoteManifest: remoteManifest, doc: remoteDoc, passthrough: passthrough)
            return SyncOutcome(kind: .pulled, mergeWarning: nil, localDataChanged: true)
        }

        let remoteContentRevision: String
        if let contentRevision = remoteManifest.contentRevision, !contentRevision.isEmpty {
            remoteContentRevision = contentRevision
        } else {
            let doc = try await requireDoc(&remoteDoc, remote: remote, manifest: remoteManifest, passthrough: passthrough)
            remoteContentRevision = await Task.detached(priority: .userInitiated) {
                BundleCodec.computeContentRevisionFromBundle(doc)
            }.value
        }
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
            store?.markSynced(revision: localRevision, contentChanged: false)
            return SyncOutcome(kind: .noop, mergeWarning: nil, localDataChanged: false)
        case .pull:
            let doc = try await requireDoc(&remoteDoc, remote: remote, manifest: remoteManifest, passthrough: passthrough)
            await beforeLocalChange?()
            try await pull(remoteManifest: remoteManifest, doc: doc, passthrough: passthrough)
            return SyncOutcome(kind: .pulled, mergeWarning: nil, localDataChanged: true)
        case .push:
            try await push(
                remote: remote,
                passthrough: passthrough,
                localRevision: localRevision,
                localContentRevision: localContentRevision,
                previousBundleHash: remoteManifest.bundleHash
            )
            return SyncOutcome(kind: .pushed, mergeWarning: nil, localDataChanged: false)
        case .conflict:
            let doc = try await requireDoc(&remoteDoc, remote: remote, manifest: remoteManifest, passthrough: passthrough)
            await beforeLocalChange?()
            let mergeWarning = try await merge(
                remote: remote,
                remoteManifest: remoteManifest,
                doc: doc,
                passthrough: passthrough
            )
            return SyncOutcome(kind: .pushed, mergeWarning: mergeWarning, localDataChanged: true)
        }
    }

    private var lastSyncedContentRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedContentRevisionKey)
    }

    private func recordSyncedRevisions(revision: String, contentRevision: String) {
        UserDefaults.standard.set(revision, forKey: Self.lastSyncedRevisionKey)
        UserDefaults.standard.set(contentRevision, forKey: Self.lastSyncedContentRevisionKey)
    }

    private func requireDoc(
        _ doc: inout BundleDocument?,
        remote: RemoteBackupStore,
        manifest: BackupManifest,
        passthrough: PassthroughStore
    ) async throws -> BundleDocument {
        if let doc { return doc }
        let fetched = try await fetchRemoteDoc(remote: remote, manifest: manifest, refreshing: passthrough)
        doc = fetched
        return fetched
    }

    /// Downloads the remote bundle, then verifies, parses, and mirrors its relayed files into
    /// the passthrough store, all off the main actor.
    private func fetchRemoteDoc(
        remote: RemoteBackupStore,
        manifest: BackupManifest,
        refreshing passthrough: PassthroughStore
    ) async throws -> BundleDocument {
        let bytes: Data
        do {
            bytes = try await remote.readBundle(bundleHash: manifest.bundleHash)
        } catch {
            if isNotFound(error) { throw SyncEngineError.bundleMissing }
            throw error
        }
        guard !bytes.isEmpty else { throw SyncEngineError.bundleMissing }
        let bundleHash = manifest.bundleHash
        return try await Task.detached(priority: .userInitiated) {
            guard BundleCodec.hashBundleBytes(bytes) == bundleHash else {
                throw SyncEngineError.bundleHashMismatch
            }
            let doc = try BundleCodec.parseBundle(bytes)
            try passthrough.replace(with: doc, bundleHash: bundleHash)
            return doc
        }.value
    }

    private func pull(
        remoteManifest: BackupManifest,
        doc: BundleDocument,
        passthrough: PassthroughStore
    ) async throws {
        let dir = localDataDir
        let remoteRevision = remoteManifest.revision
        let manifestContentRevision = remoteManifest.contentRevision ?? ""
        let revisions = try await Task.detached(priority: .userInitiated) {
            try LocalDataLayout.ensureDirectories(at: dir)
            try BundleCodec.extractBundle(localDataDir: dir, doc: doc)
            let revision = remoteRevision.isEmpty
                ? try BundleCodec.computeRevision(localDataDir: dir, fallbackDir: passthrough.filesDir)
                : remoteRevision
            let contentRevision = manifestContentRevision.isEmpty
                ? BundleCodec.computeContentRevisionFromBundle(doc)
                : manifestContentRevision
            return (revision, contentRevision)
        }.value
        recordSyncedRevisions(revision: revisions.0, contentRevision: revisions.1)
        store?.clearLocalEditsFlag()
    }

    private func merge(
        remote: RemoteBackupStore,
        remoteManifest: BackupManifest,
        doc: BundleDocument,
        passthrough: PassthroughStore
    ) async throws -> String? {
        let dir = localDataDir
        let result = try await Task.detached(priority: .userInitiated) {
            // Relayed blobs are identical on both sides by construction, so they stay out of
            // the merge and out of memory; the passthrough store already holds the remote's.
            let remoteFiles = Self.mergeableEntryMap(from: doc)
            guard !remoteFiles.isEmpty else { throw SyncEngineError.bundleMissing }
            let localFiles = try Self.loadLocalScopedFileMap(localDataDir: dir)
            let review = SyncMerge.buildConflictReview(localFiles: localFiles, remoteFiles: remoteFiles)
            let choices = SyncMerge.buildDefaultMergeChoices(
                review: review,
                localFiles: localFiles,
                remoteFiles: remoteFiles
            )
            let mergedFiles = SyncMerge.buildMergedFileMap(
                localFiles: localFiles,
                remoteFiles: remoteFiles,
                choices: choices
            )
            try Self.applyMergedFiles(mergedFiles, localDataDir: dir)
            try passthrough.applyMergedText(mergedFiles)
            let revisions = try BundleCodec.computeSyncRevisions(
                localDataDir: dir,
                fallbackDir: passthrough.filesDir
            )
            return (SyncMerge.mergeWarning(from: review), revisions.revision, revisions.contentRevision)
        }.value

        try await push(
            remote: remote,
            passthrough: passthrough,
            localRevision: result.1,
            localContentRevision: result.2,
            previousBundleHash: remoteManifest.bundleHash
        )
        return result.0
    }

    private func push(
        remote: RemoteBackupStore,
        passthrough: PassthroughStore,
        localRevision: String,
        localContentRevision: String,
        previousBundleHash: String?
    ) async throws {
        let dir = localDataDir
        let built = try await Task.detached(priority: .userInitiated) {
            try BundleCodec.buildBundle(
                localDataDir: dir,
                scopes: SyncScopes.mobilePushScopes,
                fallbackDir: passthrough.filesDir
            )
        }.value
        let manifest = BackupManifest(
            version: SyncScopes.manifestVersion,
            revision: localRevision,
            contentRevision: localContentRevision,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            bundleHash: built.bundleHash
        )
        try await remote.writeBundleAndManifest(
            bundleBytes: built.bytes,
            manifest: manifest,
            previousBundleHash: previousBundleHash
        )
        recordSyncedRevisions(revision: localRevision, contentRevision: localContentRevision)
        // The remote bundle is now exactly local files plus the store.
        let bundleHash = built.bundleHash
        await Task.detached(priority: .utility) {
            try? passthrough.setBundleHash(bundleHash)
        }.value
        store?.markSynced(revision: localRevision, contentChanged: true)
    }

    private nonisolated static func mergeableEntryMap(from doc: BundleDocument) -> [String: Data] {
        var map: [String: Data] = [:]
        for entry in doc.entries where !SyncScopes.isPassthroughBlob(entry.path) {
            guard let data = Data(base64Encoded: entry.contents), data.count == entry.size else { continue }
            map[entry.path] = data
        }
        return map
    }

    private nonisolated static func loadLocalScopedFileMap(localDataDir: URL) throws -> [String: Data] {
        let files = try BundleCodec.listScopedFiles(
            localDataDir: localDataDir,
            scopes: SyncScopes.defaultScopes
        )
        var map: [String: Data] = [:]
        // The phone never edits the image library, so its copy of the index never outvotes the remote's.
        for rel in files where rel != SyncMerge.imagesIndexPath {
            let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
            if let data = try? LocalDataLayout.readRegularFileData(at: url) {
                map[rel] = data
            }
        }
        return map
    }

    private nonisolated static func applyMergedFiles(_ merged: [String: Data], localDataDir: URL) throws {
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
    }

    private func isNotFound(_ error: Error) -> Bool {
        if let awsError = error as? AWSResponseError {
            if awsError.errorCode.lowercased().contains("nosuchkey") { return true }
            if awsError.context?.responseCode == .notFound { return true }
        }
        if let rawError = error as? AWSRawError, rawError.context.responseCode == .notFound {
            return true
        }
        let message = error.localizedDescription.lowercased()
        return message.contains("404") || message.contains("not found") || message.contains("nosuchkey")
    }

    /// Anything in `local-data` that the phone only relays is dropped once the passthrough
    /// store holds it. An attachment the store lacks was created here before attachments
    /// were tracked, so it is adopted as this phone's own instead.
    private nonisolated static func pruneNonMaterializedFiles(
        localDataDir: URL,
        passthrough: PassthroughStore
    ) throws {
        let fm = FileManager.default
        let files = try BundleCodec.listScopedFiles(localDataDir: localDataDir, scopes: SyncScopes.defaultScopes)
        for rel in files where !SyncScopes.materializesLocally(rel) {
            if !passthrough.contains(rel), rel.hasPrefix(SyncScopes.chatAttachmentsPrefix) {
                LocalAttachmentIndex.insert(rel)
                continue
            }
            try? fm.removeItem(at: LocalDataLayout.fileURL(in: localDataDir, relativePath: rel))
        }
    }
}
