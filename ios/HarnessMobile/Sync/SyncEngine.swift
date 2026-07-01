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
}

@MainActor
final class SyncEngine {
    static let lastSyncedRevisionKey = HarnessStorageKeys.lastSyncedRevision
    static let lastSyncedContentRevisionKey = HarnessStorageKeys.lastSyncedContentRevision

    let localDataDir: URL
    weak var store: ConversationStore?

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    var lastSyncedRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedRevisionKey)
    }

    func syncNow(forcePull: Bool = false) async throws -> SyncOutcome {
        let remote = try RemoteBackupStore.makeConfigured()
        try pruneNonMaterializedFiles()

        let remoteManifest = try await remote.readManifest()
        let remoteBundleData = try await loadRemoteBundleData(from: remote)

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

        if forcePull {
            _ = try await pull(remote: remote, remoteManifest: remoteManifest, remoteBundleData: remoteBundleData)
            return SyncOutcome(kind: .pulled, mergeWarning: nil)
        }

        guard let remoteManifest else {
            _ = try await push(
                remote: remote,
                localRevision: localRevision,
                localContentRevision: localContentRevision,
                passthroughData: remoteBundleData
            )
            return SyncOutcome(kind: .pushed, mergeWarning: nil)
        }

        let remoteContentRevision = try remoteContentRevision(
            manifest: remoteManifest,
            remoteBundleData: remoteBundleData
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
            return SyncOutcome(kind: .noop, mergeWarning: nil)
        case .pull:
            _ = try await pull(remote: remote, remoteManifest: remoteManifest, remoteBundleData: remoteBundleData)
            return SyncOutcome(kind: .pulled, mergeWarning: nil)
        case .push:
            _ = try await push(
                remote: remote,
                localRevision: localRevision,
                localContentRevision: localContentRevision,
                passthroughData: remoteBundleData
            )
            return SyncOutcome(kind: .pushed, mergeWarning: nil)
        case .conflict:
            let mergeWarning = try await merge(
                remote: remote,
                remoteManifest: remoteManifest,
                remoteBundleData: remoteBundleData
            )
            return SyncOutcome(kind: .pushed, mergeWarning: mergeWarning)
        }
    }

    private var lastSyncedContentRevision: String? {
        UserDefaults.standard.string(forKey: Self.lastSyncedContentRevisionKey)
    }

    private func recordSyncedRevisions(revision: String, contentRevision: String) {
        UserDefaults.standard.set(revision, forKey: Self.lastSyncedRevisionKey)
        UserDefaults.standard.set(contentRevision, forKey: Self.lastSyncedContentRevisionKey)
    }

    private func remoteContentRevision(manifest: BackupManifest, remoteBundleData: [String: Data]) throws -> String {
        if let contentRevision = manifest.contentRevision, !contentRevision.isEmpty {
            return contentRevision
        }
        guard !remoteBundleData.isEmpty else { return "" }
        let doc = BundleCodec.parseBundleFromEntryMap(remoteBundleData)
        return BundleCodec.computeContentRevisionFromBundle(doc)
    }

    private func pull(
        remote: RemoteBackupStore,
        remoteManifest: BackupManifest?,
        remoteBundleData: [String: Data]
    ) async throws -> Int {
        let bytes = try await remote.readBundle()
        guard !bytes.isEmpty else {
            throw SyncEngineError.bundleMissing
        }
        if let remoteManifest, BundleCodec.hashBundleBytes(bytes) != remoteManifest.bundleHash {
            throw SyncEngineError.bundleHashMismatch
        }
        let doc = try BundleCodec.parseBundle(bytes)
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let fileCount = try BundleCodec.extractBundle(localDataDir: localDataDir, doc: doc)
        try pruneNonMaterializedFiles()
        let contentRevision: String
        if let remoteManifest {
            contentRevision = try remoteContentRevision(manifest: remoteManifest, remoteBundleData: remoteBundleData)
        } else {
            contentRevision = BundleCodec.computeContentRevisionFromBundle(doc)
        }
        let revision = try remoteManifest?.revision ?? BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackData: remoteBundleData
        )
        recordSyncedRevisions(revision: revision, contentRevision: contentRevision)
        store?.clearLocalEditsFlag()
        try store?.reload()
        return fileCount
    }

    @discardableResult
    private func merge(
        remote: RemoteBackupStore,
        remoteManifest: BackupManifest?,
        remoteBundleData: [String: Data]
    ) async throws -> String? {
        guard remoteManifest != nil else { throw SyncEngineError.manifestMissing }
        guard !remoteBundleData.isEmpty else { throw SyncEngineError.bundleMissing }

        let localFiles = try loadLocalScopedFileMap()
        let review = SyncMerge.buildConflictReview(localFiles: localFiles, remoteFiles: remoteBundleData)
        let choices = SyncMerge.buildDefaultMergeChoices(review: review)
        let mergeWarning = SyncMerge.mergeWarning(from: review)
        let mergedFiles = SyncMerge.buildMergedFileMap(
            localFiles: localFiles,
            remoteFiles: remoteBundleData,
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
        _ = try await push(
            remote: remote,
            localRevision: localRevision,
            localContentRevision: localContentRevision,
            passthroughData: passthrough
        )
        return mergeWarning
    }

    private func push(
        remote: RemoteBackupStore,
        localRevision: String,
        localContentRevision: String,
        passthroughData: [String: Data],
        extraPassthrough: [String: Data] = [:]
    ) async throws -> Int {
        var mergedPassthrough = passthroughData
        for (path, data) in extraPassthrough {
            mergedPassthrough[path] = data
        }
        let built = try BundleCodec.buildBundle(
            localDataDir: localDataDir,
            scopes: SyncScopes.mobilePushScopes,
            passthroughData: mergedPassthrough
        )
        let manifest = BackupManifest(
            version: SyncScopes.manifestVersion,
            revision: localRevision,
            contentRevision: localContentRevision,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            bundleHash: built.bundleHash
        )
        try await remote.writeBundleAndManifest(bundleBytes: built.bytes, manifest: manifest)
        recordSyncedRevisions(revision: localRevision, contentRevision: localContentRevision)
        store?.markSynced(revision: localRevision)
        return built.entries.count
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
    }

    private func loadRemoteBundleData(from remote: RemoteBackupStore) async throws -> [String: Data] {
        do {
            let bytes = try await remote.readBundle()
            guard !bytes.isEmpty else { return [:] }
            let doc = try BundleCodec.parseBundle(bytes)
            return BundleCodec.entryDataMap(from: doc)
        } catch {
            if isNotFound(error) { return [:] }
            throw error
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
