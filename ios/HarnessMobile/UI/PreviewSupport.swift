import Foundation
import SwiftUI

// MARK: - Preview fixtures

@MainActor
enum PreviewSupport {
    static let sampleConversationId = "conv_preview_thread"
    static let secondConversationId = "conv_preview_notes"

    /// App with seeded conversations and messages for canvas previews.
    static func populatedApp(
        syncStatus: SyncStatusSnapshot? = nil,
        isSyncing: Bool = false,
        hasLocalEdits: Bool = false,
        needsBackupFolder: Bool = false,
        needsAPIKey: Bool = false
    ) -> AppModel {
        let app = AppModel(localDataSubpath: "preview-\(UUID().uuidString)")
        try? seedSampleData(app: app)
        if let syncStatus {
            app.syncStatus = syncStatus
        }
        app.isSyncing = isSyncing
        if hasLocalEdits {
            app.store.markEdited()
        }
        app.needsBackupFolder = needsBackupFolder
        app.needsAPIKey = needsAPIKey
        app.lastSuccessfulSyncAt = Date().addingTimeInterval(-3600)
        return app
    }

    static let pulledStatus = SyncStatusSnapshot(
        kind: .pulled,
        title: "Downloaded from backup folder",
        detail: "1 new: Trip planning · 4 files applied",
        occurredAt: Date()
    )

    static func emptyApp(
        syncStatus: SyncStatusSnapshot? = nil,
        needsBackupFolder: Bool = true,
        needsAPIKey: Bool = true
    ) -> AppModel {
        let app = AppModel(localDataSubpath: "preview-empty-\(UUID().uuidString)")
        try? LocalDataLayout.ensureDirectories(at: app.localDataDir)
        try? app.store.reload()
        if let syncStatus {
            app.syncStatus = syncStatus
        }
        app.needsBackupFolder = needsBackupFolder
        app.needsAPIKey = needsAPIKey
        return app
    }

    private static func seedSampleData(app: AppModel) throws {
        try LocalDataLayout.ensureDirectories(at: app.localDataDir)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let yesterday = now - 86_400_000

        let conversations: [String: ConversationMeta] = [
            sampleConversationId: ConversationMeta(
                title: "Trip planning",
                createdAt: now,
                sessionKind: "chat",
                hasAssistantReply: true
            ),
            secondConversationId: ConversationMeta(
                title: nil,
                createdAt: yesterday,
                sessionKind: "chat",
                hasAssistantReply: false
            ),
        ]
        let convPath = LocalDataLayout.fileURL(in: app.localDataDir, relativePath: LocalDataLayout.conversationsFile)
        try JSONEncoder().encode(conversations).write(to: convPath, options: .atomic)

        let threadMessages: [MessageRecord] = [
            MessageRecord(
                role: "user",
                content: "What should I pack for a week in Tokyo in April?",
                timestamp: now - 120_000,
                model: nil
            ),
            MessageRecord(
                role: "assistant",
                content: """
                Pack layers: light rain jacket, comfortable walking shoes, and a compact umbrella. \
                April is mild (roughly 50–65°F) with occasional showers. Bring a universal adapter \
                and a small day bag for transit.
                """,
                timestamp: now - 60_000,
                model: OpenAIModel.chat
            ),
        ]
        try app.store.saveMessages(conversationId: sampleConversationId, messages: threadMessages)
        try app.store.saveMessages(conversationId: secondConversationId, messages: [])
        app.store.clearLocalEditsFlag()
        try app.store.reload()
    }
}

// MARK: - Shared preview chrome

struct PreviewNavigationRoot<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        NavigationStack {
            content()
        }
    }
}
