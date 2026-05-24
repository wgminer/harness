import SwiftUI

struct ContentView: View {
    @StateObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init(app: AppModel? = nil) {
        _app = StateObject(wrappedValue: app ?? AppModel())
    }

    var body: some View {
        NavigationStack {
            Group {
                if let id = app.selectedConversationId {
                    ChatThreadView(app: app, conversationId: id)
                } else {
                    ConversationListView(app: app) { conversationId in
                        app.selectedConversationId = conversationId
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 16) {
                        if app.selectedConversationId != nil {
                            SyncToolbarButton(app: app) {
                                Task { await app.performSync() }
                            }
                        }
                        NavigationLink {
                            MobileSettingsView(app: app)
                        } label: {
                            ZStack(alignment: .topTrailing) {
                                Image(systemName: "gearshape")
                                if let settingsAttentionColor {
                                    SyncAttentionDot(color: settingsAttentionColor)
                                }
                            }
                        }
                    }
                }
                if app.selectedConversationId != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Chats") {
                            app.selectedConversationId = nil
                        }
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                SyncStatusBanner(status: app.syncStatus) {
                    app.dismissSyncStatus()
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: app.syncStatus)
        .task {
            await app.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await app.syncOnForeground() }
            }
        }
        .sheet(isPresented: $app.showConflictSheet) {
            SyncConflictView(app: app)
        }
        .alert("Setup required", isPresented: setupAlertBinding) {
            Button("Settings") {
                // User navigates via gear icon
            }
        } message: {
            Text(setupMessage)
        }
    }

    private var setupAlertBinding: Binding<Bool> {
        Binding(
            get: { app.needsBackupFolder || app.needsAPIKey },
            set: { _ in }
        )
    }

    private var setupMessage: String {
        var parts: [String] = []
        if app.needsBackupFolder {
            parts.append("Link your Harness backup folder in Settings.")
        }
        if app.needsAPIKey {
            parts.append("Add your OpenAI API key in Settings.")
        }
        return parts.joined(separator: " ")
    }

    private var settingsAttentionColor: Color? {
        if app.syncStatus.showsAttentionDot {
            return app.syncStatus.kind == .conflict ? .orange : .red
        }
        if app.store.hasLocalEdits {
            return .orange
        }
        return nil
    }
}

#Preview("Conversation list") {
    ContentView(app: PreviewSupport.populatedApp())
}

#Preview("Chat thread") {
    ContentView(
        app: {
            let app = PreviewSupport.populatedApp()
            app.selectedConversationId = PreviewSupport.sampleConversationId
            return app
        }()
    )
}

#Preview("Setup required") {
    ContentView(app: PreviewSupport.emptyApp())
}

#Preview("Sync status banner") {
    ContentView(app: PreviewSupport.populatedApp(syncStatus: PreviewSupport.pulledStatus))
}
