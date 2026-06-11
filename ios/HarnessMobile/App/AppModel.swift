import Combine
import Foundation
import SwiftUI

enum ChatRoute: Hashable {
    case compose
    case thread(id: String)
}

@MainActor
final class AppModel: ObservableObject {
    static let lastSuccessfulSyncAtKey = "harness.lastSuccessfulSyncAt"

    @Published var syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
    @Published var isSyncing = false
    @Published var chatRoute: ChatRoute?
    var composeDraft = ""
    private var pendingOutboundMessages: [String: String] = [:]
    private var composerDraftCache: [String: String] = [:]
    @Published var needsBackupFolder = false
    @Published var needsAPIKey = false
    @Published var lastSuccessfulSyncAt: Date?
    @Published private(set) var hasCompletedInitialLoad = false
    @Published private(set) var headerQuoteRotationIndex = 0

    let localDataDir: URL
    let store: ConversationStore
    let tasksStore: TasksStore
    let syncEngine: SyncEngine
    let chatService: ChatService
    let dictationService: DictationService

    private var pendingAutoGenerateReply: Set<String> = []
    private var pendingComposerFocus: Set<String> = []
    private var cancellables = Set<AnyCancellable>()

    init(localDataSubpath: String = "local-data") {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        localDataDir = docs.appendingPathComponent(localDataSubpath, isDirectory: true)
        store = ConversationStore(localDataDir: localDataDir)
        tasksStore = TasksStore(localDataDir: localDataDir)
        syncEngine = SyncEngine(localDataDir: localDataDir)
        chatService = ChatService(store: store, tasksStore: tasksStore)
        dictationService = DictationService(localDataDir: localDataDir)
        syncEngine.store = store
        lastSuccessfulSyncAt = UserDefaults.standard.object(forKey: Self.lastSuccessfulSyncAtKey) as? Date
        forwardObjectWillChange(from: store)
        forwardObjectWillChange(from: tasksStore)
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

    func markPendingAutoGenerateReply(conversationId: String) {
        pendingAutoGenerateReply.insert(conversationId)
    }

    func takePendingAutoGenerateReply(conversationId: String) -> Bool {
        pendingAutoGenerateReply.remove(conversationId) != nil
    }

    func markPendingComposerFocus(conversationId: String) {
        pendingComposerFocus.insert(conversationId)
    }

    func consumePendingComposerFocus(conversationId: String) -> Bool {
        pendingComposerFocus.remove(conversationId) != nil
    }

    func cachedComposerDraft(conversationId: String) -> String {
        composerDraftCache[conversationId] ?? ""
    }

    func cacheComposerDraft(_ draft: String, conversationId: String) {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            composerDraftCache.removeValue(forKey: conversationId)
        } else {
            composerDraftCache[conversationId] = draft
        }
    }

    func clearComposerDraft(conversationId: String) {
        composerDraftCache.removeValue(forKey: conversationId)
    }

    func cacheComposeDraft(_ draft: String) {
        composeDraft = draft
    }

    func clearComposeDraft() {
        composeDraft = ""
    }

    func openCompose() {
        chatRoute = .compose
    }

    func openThread(id: String) {
        chatRoute = .thread(id: id)
    }

    func bootstrap() async {
        try? LocalDataLayout.ensureDirectories(at: localDataDir)
        try? LocalDataLayout.ensureConversationsFile(at: localDataDir)
        do {
            try store.pruneEmptyConversations()
            try store.reload()
            try tasksStore.reload()
            try store.refreshPendingSyncState()
        } catch {
            syncStatus = SyncStatusSnapshot(
                kind: .error,
                title: "Could not load conversations",
                detail: error.localizedDescription,
                occurredAt: Date()
            )
        }
        hasCompletedInitialLoad = true
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

    func markInitialLoadCompleteForPreviews() {
        hasCompletedInitialLoad = true
    }

    func performSync(forcePull: Bool = false) async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let outcome = try await syncEngine.syncNow(forcePull: forcePull)
            applyOutcome(outcome)
            try store.reload()
            try tasksStore.reload()
            try store.refreshPendingSyncState()
            chatService.refreshClient()
        } catch {
            applyError(error)
            try? store.reload()
            try? tasksStore.reload()
            try? store.refreshPendingSyncState()
            chatService.refreshClient()
        }
    }

    func pushAfterChat() async {
        guard BookmarkStore.hasBookmark else { return }
        await performSync()
    }

    func deleteConversation(id: String) throws {
        try store.deleteConversation(id: id)
        if case .thread(let activeId) = chatRoute, activeId == id {
            chatRoute = nil
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

    /// Creates a dictation session with the transcribed user message already stored.
    /// Schedules LLM title refinement to match desktop `markVoiceDictationSession`.
    @discardableResult
    func createDictationConversation(userMessage: String, recordingURL: URL? = nil) throws -> String {
        let conversationId = try store.createDictationConversation(
            userMessage: userMessage,
            recordingURL: recordingURL
        )
        chatService.scheduleTitleRefinement(conversationId: conversationId)
        return conversationId
    }

    /// Re-transcribe a saved recording and open a fresh dictation conversation.
    func retranscribeRecording(at url: URL) async throws -> String {
        let transcript = try await dictationService.transcribeRecording(at: url)
        let conversationId = try createDictationConversation(
            userMessage: transcript,
            recordingURL: url
        )
        if dictationService.loadSettings().autoSend {
            markPendingAutoGenerateReply(conversationId: conversationId)
        }
        return conversationId
    }

    var pendingChangesDetail: String? {
        guard store.hasLocalEdits else { return nil }
        guard let current = try? store.snapshotConversations() else {
            return "This phone has unsynced changes."
        }
        if let baseline = PendingSyncTracker.loadBaseline(),
           let detail = SyncChangeSummary.describePendingLocalChanges(baseline: baseline, current: current) {
            return detail
        }
        return "This phone has unsynced changes."
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
