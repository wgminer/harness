import Combine
import Foundation
import SwiftUI

enum ChatRoute: Hashable {
    case compose
    case thread(id: String)
}

enum ComposerDraftStorage {
    static let composeDraftKey = HarnessStorageKeys.composeDraft
    static let threadDraftsKey = HarnessStorageKeys.threadDrafts
    static var userDefaults: UserDefaults = .standard

    static func loadComposeDraft() -> String {
        userDefaults.string(forKey: composeDraftKey) ?? ""
    }

    static func saveComposeDraft(_ draft: String) {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            userDefaults.removeObject(forKey: composeDraftKey)
        } else {
            userDefaults.set(draft, forKey: composeDraftKey)
        }
    }

    static func loadThreadDrafts() -> [String: String] {
        guard let data = userDefaults.data(forKey: threadDraftsKey),
              let drafts = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return drafts
    }

    static func saveThreadDrafts(_ drafts: [String: String]) {
        if drafts.isEmpty {
            userDefaults.removeObject(forKey: threadDraftsKey)
        } else if let data = try? JSONEncoder().encode(drafts) {
            userDefaults.set(data, forKey: threadDraftsKey)
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let lastSuccessfulSyncAtKey = HarnessStorageKeys.lastSuccessfulSyncAt
    static let setupNoticeDismissedKey = HarnessStorageKeys.setupNoticeDismissed

    @Published var syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
    @Published var isSyncing = false
    @Published var chatRoute: ChatRoute?
    var composeDraft = ""
    private var pendingOutboundMessages: [String: String] = [:]
    private var composerDraftCache: [String: String] = [:]
    @Published var syncNotConfigured = false
    @Published var needsAPIKey = false
    @Published var showSetupNotice = false
    @Published private(set) var setupNoticeDismissed = false
    @Published var lastSuccessfulSyncAt: Date?
    @Published private(set) var hasCompletedInitialLoad = false
    @Published private(set) var headerQuoteRotationIndex = 0

    let localDataDir: URL
    let store: ConversationStore
    let tasksStore: TasksStore
    let syncEngine: SyncEngine
    let chatService: ChatService
    let dictationService: DictationService
    let themeStore: ThemeStore

    private var pendingAutoGenerateReply: Set<String> = []
    private var cancellables = Set<AnyCancellable>()

    init(localDataSubpath: String = "local-data") {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        localDataDir = docs.appendingPathComponent(localDataSubpath, isDirectory: true)
        store = ConversationStore(localDataDir: localDataDir)
        tasksStore = TasksStore(localDataDir: localDataDir)
        syncEngine = SyncEngine(localDataDir: localDataDir)
        chatService = ChatService(store: store, tasksStore: tasksStore)
        dictationService = DictationService(localDataDir: localDataDir)
        themeStore = ThemeStore()
        syncEngine.store = store
        lastSuccessfulSyncAt = UserDefaults.standard.object(forKey: Self.lastSuccessfulSyncAtKey) as? Date
        setupNoticeDismissed = UserDefaults.standard.bool(forKey: Self.setupNoticeDismissedKey)
        composeDraft = ComposerDraftStorage.loadComposeDraft()
        composerDraftCache = ComposerDraftStorage.loadThreadDrafts()
        forwardObjectWillChange(from: store)
        forwardObjectWillChange(from: tasksStore)
        wireContentChangeHandlers()
    }

    private static let autoSyncDelayNs: UInt64 = 2_500_000_000
    private static let pendingStateRefreshDelayNs: UInt64 = 200_000_000

    private var scheduledSyncTask: Task<Void, Never>?
    private var pendingStateRefreshTask: Task<Void, Never>?
    @Published private(set) var hasScheduledSync = false

    private func wireContentChangeHandlers() {
        let onLocalContentChanged: () -> Void = { [weak self] in
            self?.schedulePendingStateRefresh()
            self?.scheduleSyncAfterLocalChange()
        }
        store.onContentChanged = onLocalContentChanged
        tasksStore.onContentChanged = onLocalContentChanged
    }

    func scheduleSyncAfterLocalChange() {
        guard R2SettingsStore.isConfigured else { return }
        scheduledSyncTask?.cancel()
        hasScheduledSync = true
        scheduledSyncTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: Self.autoSyncDelayNs)
            } catch {
                await self?.clearScheduledSync()
                return
            }
            guard !Task.isCancelled else {
                await self?.clearScheduledSync()
                return
            }
            await self?.performSync()
            await self?.clearScheduledSync()
        }
    }

    private func schedulePendingStateRefresh() {
        pendingStateRefreshTask?.cancel()
        pendingStateRefreshTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: Self.pendingStateRefreshDelayNs)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            try? self?.store.refreshPendingSyncState()
        }
    }

    private func clearScheduledSync() {
        hasScheduledSync = false
        scheduledSyncTask = nil
    }

    /// Orange/red dot on the settings gear — only real upload backlog or sync errors.
    var settingsAttentionColor: Color? {
        if syncStatus.showsAttentionDot {
            return .red
        }
        if showsPendingUploadAttention {
            return .orange
        }
        return nil
    }

    var showsPendingUploadAttention: Bool {
        store.hasLocalEdits && !isSyncing && !hasScheduledSync
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

    func hasPendingOutboundMessage(conversationId: String) -> Bool {
        pendingOutboundMessages[conversationId] != nil
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
        ComposerDraftStorage.saveThreadDrafts(composerDraftCache)
    }

    func clearComposerDraft(conversationId: String) {
        composerDraftCache.removeValue(forKey: conversationId)
        ComposerDraftStorage.saveThreadDrafts(composerDraftCache)
    }

    func cacheComposeDraft(_ draft: String) {
        composeDraft = draft
        ComposerDraftStorage.saveComposeDraft(draft)
    }

    func clearComposeDraft() {
        composeDraft = ""
        ComposerDraftStorage.saveComposeDraft("")
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
        refreshSetupFlags()
        maybePresentSetupNotice()
        if R2SettingsStore.isConfigured {
            await syncOnForeground()
        }
    }

    func refreshSetupFlags() {
        syncNotConfigured = !R2SettingsStore.isConfigured
        needsAPIKey = KeychainStore.loadAPIKey() == nil
    }

    func maybePresentSetupNotice() {
        guard !setupNoticeDismissed else { return }
        if needsAPIKey || syncNotConfigured {
            showSetupNotice = true
        }
    }

    func dismissSetupNotice() {
        setupNoticeDismissed = true
        UserDefaults.standard.set(true, forKey: Self.setupNoticeDismissedKey)
        showSetupNotice = false
    }

    func syncOnForeground() async {
        bumpHeaderQuoteRotation()
        guard R2SettingsStore.isConfigured else { return }
        await performSync()
    }

    func bumpHeaderQuoteRotation() {
        headerQuoteRotationIndex += 1
    }

    func markInitialLoadCompleteForPreviews() {
        hasCompletedInitialLoad = true
    }

    func performSync(forcePull: Bool = false) async {
        guard R2SettingsStore.isConfigured else {
            syncNotConfigured = true
            return
        }
        scheduledSyncTask?.cancel()
        clearScheduledSync()
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
        guard R2SettingsStore.isConfigured else { return }
        await performSync()
    }

    func deleteConversation(id: String) throws {
        try store.deleteConversation(id: id)
        if case .thread(let activeId) = chatRoute, activeId == id {
            chatRoute = nil
        }
    }

    func importAPIKeyFromSyncedSettings() throws -> Bool {
        guard !KeychainStore.hasImportedOpenAIKeyFromSync else { return false }
        guard let key = try store.loadSettingsOpenAIKey() else { return false }
        try KeychainStore.saveAPIKey(key)
        KeychainStore.hasImportedOpenAIKeyFromSync = true
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
        guard showsPendingUploadAttention else { return nil }
        guard let current = try? store.snapshotConversations() else {
            return "Changes waiting to upload."
        }
        if let baseline = PendingSyncTracker.loadBaseline(),
           let detail = SyncChangeSummary.describePendingLocalChanges(baseline: baseline, current: current) {
            return detail
        }
        return "Changes waiting to upload."
    }

    /// Plain-language sync line for Settings.
    var syncStatusSummary: String {
        if isSyncing {
            return "Syncing…"
        }
        if hasScheduledSync {
            return "Uploading changes shortly…"
        }
        if syncStatus.kind == .error {
            return syncStatus.title
        }
        if showsPendingUploadAttention {
            return pendingChangesDetail ?? "Changes waiting to upload."
        }
        if let lastSuccessfulSyncAt {
            let ago = lastSuccessfulSyncAt.formatted(.relative(presentation: .named))
            return "Synced \(ago)"
        }
        if R2SettingsStore.isConfigured {
            return "No sync completed yet on this phone."
        }
        return "Configure Cloudflare R2 in Settings to sync with desktop."
    }

    private func applyOutcome(_ outcome: SyncOutcome) {
        switch outcome.kind {
        case .noop, .pulled, .pushed:
            recordSuccessfulSync()
            if let mergeWarning = outcome.mergeWarning, !mergeWarning.isEmpty {
                syncStatus = SyncStatusSnapshot(
                    kind: .idle,
                    title: mergeWarning,
                    detail: nil,
                    occurredAt: Date()
                )
            } else {
                syncStatus = SyncStatusSnapshot(kind: .idle, title: "", detail: nil, occurredAt: nil)
            }
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
