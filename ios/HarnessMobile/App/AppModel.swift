import Combine
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    static let lastSuccessfulSyncAtKey = "harness.lastSuccessfulSyncAt"

    @Published var syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
    @Published var isSyncing = false
    @Published var selectedConversationId: String?
    private var pendingOutboundMessages: [String: String] = [:]
    @Published var needsBackupFolder = false
    @Published var needsAPIKey = false
    @Published var lastSuccessfulSyncAt: Date?
    @Published private(set) var headerQuoteRotationIndex = 0

    let localDataDir: URL
    let store: ConversationStore
    let clippingsStore: ClippingsStore
    let syncEngine: SyncEngine
    let chatService: ChatService

    private var cancellables = Set<AnyCancellable>()

    init(localDataSubpath: String = "local-data") {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        localDataDir = docs.appendingPathComponent(localDataSubpath, isDirectory: true)
        store = ConversationStore(localDataDir: localDataDir)
        clippingsStore = ClippingsStore(localDataDir: localDataDir, conversationStore: store)
        syncEngine = SyncEngine(localDataDir: localDataDir)
        chatService = ChatService(store: store)
        syncEngine.store = store
        lastSuccessfulSyncAt = UserDefaults.standard.object(forKey: Self.lastSuccessfulSyncAtKey) as? Date
        forwardObjectWillChange(from: store)
        forwardObjectWillChange(from: clippingsStore)
    }

    private func forwardObjectWillChange<P: ObservableObject>(from publisher: P) {
        publisher.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    func queueOutboundMessage(conversationId: String, text: String) {
        pendingOutboundMessages[conversationId] = text
    }

    func takePendingOutboundMessage(conversationId: String) -> String? {
        pendingOutboundMessages.removeValue(forKey: conversationId)
    }

    func bootstrap() async {
        try? LocalDataLayout.ensureDirectories(at: localDataDir)
        try? LocalDataLayout.ensureConversationsFile(at: localDataDir)
        do {
            try store.reload()
            try clippingsStore.reload()
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
        bumpHeaderQuoteRotation()
        guard BookmarkStore.hasBookmark else {
            needsBackupFolder = true
            return
        }
        await performSync()
    }

    func bumpHeaderQuoteRotation() {
        headerQuoteRotationIndex += 1
    }

    func performSync(forcePull: Bool = false) async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let outcome = try await syncEngine.syncNow(forcePull: forcePull)
            applyOutcome(outcome)
            try store.reload()
            try clippingsStore.reload()
            chatService.refreshClient()
        } catch {
            applyError(error)
            try? store.reload()
            try? clippingsStore.reload()
            chatService.refreshClient()
        }
    }

    func pushAfterChat() async {
        guard BookmarkStore.hasBookmark else { return }
        await performSync()
    }

    func pushAfterClippingEdit() async {
        guard BookmarkStore.hasBookmark else { return }
        await performSync()
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
        switch outcome.kind {
        case .noop, .pulled, .pushed:
            recordSuccessfulSync()
            syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
        }
    }

    private func applyError(_ error: Error) {
        syncStatus = SyncStatusSnapshot(
            kind: .error,
            title: "Sync failed",
            detail: error.localizedDescription,
            occurredAt: Date()
        )
    }

    private func recordSuccessfulSync() {
        let now = Date()
        lastSuccessfulSyncAt = now
        UserDefaults.standard.set(now, forKey: Self.lastSuccessfulSyncAtKey)
    }
}
