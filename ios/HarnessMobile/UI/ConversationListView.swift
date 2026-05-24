import SwiftUI

struct ConversationListView: View {
    @ObservedObject var app: AppModel
    let onSelect: (String) -> Void

    var body: some View {
        List {
            if app.store.conversations.isEmpty {
                ContentUnavailableView(
                    "No conversations",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new chat or sync from your Mac backup folder.")
                )
            } else {
                ForEach(app.store.conversations) { item in
                    Button {
                        onSelect(item.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.displayTitle)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            if item.hasAssistantReply {
                                Text("Has replies")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Harness")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New") {
                    Task {
                        if let id = try? app.store.createConversation() {
                            onSelect(id)
                        }
                    }
                }
            }
            ToolbarItem(placement: .topBarLeading) {
                SyncToolbarButton(app: app) {
                    Task { await app.performSync() }
                }
            }
        }
    }
}

#Preview("With conversations") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(syncStatus: PreviewSupport.pulledStatus)) { _ in }
    }
}

#Preview("Empty") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.emptyApp(needsBackupFolder: false, needsAPIKey: false)) { _ in }
    }
}

#Preview("Syncing") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(isSyncing: true)) { _ in }
    }
}

#Preview("Pending edits") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(hasLocalEdits: true)) { _ in }
    }
}
