import SwiftUI

struct ContentView: View {
    @StateObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init(app: AppModel? = nil) {
        _app = StateObject(wrappedValue: app ?? AppModel())
    }

    var body: some View {
        NavigationStack {
            ConversationListView(app: app) { conversationId in
                app.openThread(id: conversationId)
            }
            .navigationDestination(item: chatRouteBinding) { route in
                switch route {
                case .compose:
                    ComposeChatView(app: app)
                case .thread(let conversationId):
                    ChatThreadView(app: app, conversationId: conversationId)
                }
            }
        }
        .environment(\.harnessTheme, app.themeStore.harnessTheme)
        .preferredColorScheme(app.themeStore.preferredColorScheme)
        .tint(Color(themeHex: app.themeStore.harnessTheme.derived.accent))
        .task {
            await app.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await app.syncOnForeground() }
            }
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

    private var chatRouteBinding: Binding<ChatRoute?> {
        Binding(
            get: { app.chatRoute },
            set: { newValue in
                if newValue == nil, case .compose = app.chatRoute {
                    app.clearComposeDraft()
                }
                app.chatRoute = newValue
            }
        )
    }
}

#Preview("Conversation list") {
    ContentView(app: PreviewSupport.populatedApp())
}

#Preview("Chat thread") {
    ContentView(
        app: {
            let app = PreviewSupport.populatedApp()
            app.openThread(id: PreviewSupport.sampleConversationId)
            return app
        }()
    )
}

#Preview("Setup required") {
    ContentView(app: PreviewSupport.emptyApp())
}
