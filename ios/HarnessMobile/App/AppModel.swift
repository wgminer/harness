import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    static let lastSuccessfulSyncAtKey = "harness.lastSuccessfulSyncAt"

    @Published var syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
    @Published var isSyncing = false
    @Published var showConflictSheet = false
    @Published var syncConflictContext: SyncConflictContext?
    @Published var selectedConversationId: String?
    @Published var needsBackupFolder = false
    @Published var needsAPIKey = false
    @Published var lastSuccessfulSyncAt: Date?

    let localDataDir: URL
    let store: ConversationStore
    let syncEngine: SyncEngine
    let chatService: ChatService

    private var dismissStatusTask: Task<Void, Never>?

    init(localDataSubpath: String = "local-data") {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        localDataDir = docs.appendingPathComponent(localDataSubpath, isDirectory: true)
        store = ConversationStore(localDataDir: localDataDir)
        syncEngine = SyncEngine(localDataDir: localDataDir)
        chatService = ChatService(store: store)
        syncEngine.store = store
        lastSuccessfulSyncAt = UserDefaults.standard.object(forKey: Self.lastSuccessfulSyncAtKey) as? Date
    }

    func bootstrap() async {
        try? LocalDataLayout.ensureDirectories(at: localDataDir)
        try? LocalDataLayout.ensureConversationsFile(at: localDataDir)
        do {
            try store.reload()
        } catch {
            syncStatus = SyncStatusSnapshot(
                kind: .error,
                title: "Could not load conversations",
                detail: error.localizedDescription,
                occurredAt: Date()
            )
        }
        chatService.refreshClient()
        needsBackupFolder = !BookmarkStore.hasBookmark
        needsAPIKey = KeychainStore.loadAPIKey() == nil
        if BookmarkStore.hasBookmark {
            await syncOnForeground()
        }
    }

    func syncOnForeground() async {
        guard BookmarkStore.hasBookmark else {
            needsBackupFolder = true
            return
        }
        await performSync()
    }

    func performSync(forcePull: Bool = false, forcePush: Bool = false) async {
        dismissStatusTask?.cancel()
        isSyncing = true
        syncStatus = SyncStatusSnapshot(
            kind: .syncing,
            title: "Syncing with backup folder…",
            detail: pendingChangesDetail,
            occurredAt: Date()
        )
        defer { isSyncing = false }

        do {
            let outcome = try await syncEngine.syncNow(forcePull: forcePull, forcePush: forcePush)
            applyOutcome(outcome)
            try store.reload()
            chatService.refreshClient()
        } catch {
            applyError(error)
            try? store.reload()
            chatService.refreshClient()
        }
    }

    func dismissSyncStatus() {
        dismissStatusTask?.cancel()
        syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
    }

    func pushAfterChat() async {
        guard BookmarkStore.hasBookmark else { return }
        await performSync(forcePush: false)
        if showConflictSheet { return }
        if store.hasLocalEdits {
            await performSync(forcePush: true)
        }
    }

    func importAPIKeyFromSyncedSettings() throws -> Bool {
        guard let key = try store.loadSettingsOpenAIKey() else { return false }
        try KeychainStore.saveAPIKey(key)
        chatService.refreshClient()
        needsAPIKey = false
        return true
    }

    func saveAPIKey(_ key: String) throws {
        try KeychainStore.saveAPIKey(key)
        chatService.refreshClient()
        needsAPIKey = key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var pendingChangesDetail: String? {
        guard store.hasLocalEdits else { return nil }
        let count = store.conversations.count
        if count == 0 {
            return "This phone has unsynced changes."
        }
        return "This phone has unsynced changes across \(count) conversation\(count == 1 ? "" : "s")."
    }

    private func applyOutcome(_ outcome: SyncOutcome) {
        let kind: SyncStatusSnapshot.Kind
        switch outcome.kind {
        case .noop:
            kind = .upToDate
            recordSuccessfulSync()
        case .pulled:
            kind = .pulled
            recordSuccessfulSync()
        case .pushed:
            kind = .pushed
            recordSuccessfulSync()
        case .conflict:
            kind = .conflict
        }

        syncStatus = SyncStatusSnapshot(
            kind: kind,
            title: outcome.message,
            detail: outcome.detail,
            occurredAt: Date()
        )
        syncConflictContext = outcome.conflictContext
        showConflictSheet = outcome.kind == .conflict
        scheduleAutoDismiss(for: kind)
    }

    private func applyError(_ error: Error) {
        syncStatus = SyncStatusSnapshot(
            kind: .error,
            title: "Sync failed",
            detail: error.localizedDescription,
            occurredAt: Date()
        )
        syncConflictContext = nil
        showConflictSheet = false
    }

    private func recordSuccessfulSync() {
        let now = Date()
        lastSuccessfulSyncAt = now
        UserDefaults.standard.set(now, forKey: Self.lastSuccessfulSyncAtKey)
    }

    private func scheduleAutoDismiss(for kind: SyncStatusSnapshot.Kind) {
        let delay: TimeInterval?
        switch kind {
        case .upToDate:
            delay = 4
        case .pulled, .pushed:
            delay = 8
        default:
            delay = nil
        }
        guard let delay else { return }

        dismissStatusTask = Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            if syncStatus.kind == kind {
                dismissSyncStatus()
            }
        }
    }
}
