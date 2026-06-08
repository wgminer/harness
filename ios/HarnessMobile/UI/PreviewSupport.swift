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
        needsAPIKey: Bool = false,
        withTasks: Bool = false
    ) -> AppModel {
        let app = AppModel(localDataSubpath: "preview-\(UUID().uuidString)")
        try? seedSampleData(app: app, withTasks: withTasks)
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

    private static func seedSampleData(app: AppModel, withTasks: Bool = false) throws {
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
                content: """
                What should I pack for a week in **Tokyo** in April? \
                I care about `rain` and walking a lot.
                """,
                timestamp: now - 120_000,
                model: nil
            ),
            MessageRecord(
                role: "assistant",
                content: """
                ### Packing for Tokyo in April

                April is mild (roughly 50–65°F) with occasional showers. Pack layers:

                - Light rain jacket
                - Comfortable walking shoes
                - Compact umbrella
                - Universal adapter

                Example checklist helper:

                ```swift
                struct PackItem: Identifiable {
                    let id = UUID()
                    let name: String
                    let packed: Bool
                }
                ```

                See [Japan weather](https://www.jma.go.jp/) for updates.
                """,
                timestamp: now - 60_000,
                model: OpenAIModel.chat
            ),
        ]
        try app.store.saveMessages(conversationId: sampleConversationId, messages: threadMessages)
        try app.store.saveMessages(conversationId: secondConversationId, messages: [])
        try seedClippingsNote(app: app)
        if withTasks {
            try seedTasks(app: app)
        }
        app.store.clearLocalEditsFlag()
        try app.store.reload()
        try app.tasksStore.reload()
    }

    private static func seedTasks(app: AppModel) throws {
        _ = try app.tasksStore.create(title: "Review mobile tasks UI", tags: ["ios"])
        _ = try app.tasksStore.create(title: "Ship parity with desktop", tags: ["sync"])
        app.store.clearLocalEditsFlag()
    }

    private static func seedClippingsNote(app: AppModel) throws {
        let noteId = UUID().uuidString
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let notesIndex: [String: Any] = [
            "notes": [[
                "id": noteId,
                "title": HeaderQuotePolicy.clippingsNoteTitle,
                "createdAt": now,
                "updatedAt": now,
                "wordCount": 12,
            ]],
        ]
        let indexPath = LocalDataLayout.fileURL(in: app.localDataDir, relativePath: LocalDataLayout.notesIndexFile)
        try JSONSerialization.data(withJSONObject: notesIndex).write(to: indexPath, options: .atomic)
        let noteBody = """
        # Clippings

        1. Sample clipping for previews #preview #sample
        2. Waste no more time arguing what a good man should be. #quotes
        """
        let notePath = LocalDataLayout.fileURL(in: app.localDataDir, relativePath: LocalDataLayout.noteFile(id: noteId))
        try noteBody.write(to: notePath, atomically: true, encoding: .utf8)
    }
}

// MARK: - Shared preview chrome

struct PreviewNavigationRoot<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        NavigationStack {
            content()
        }
        .preferredColorScheme(.dark)
    }
}
