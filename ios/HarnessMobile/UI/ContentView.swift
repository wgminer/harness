import SwiftUI

struct ContentView: View {
    @StateObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSetupSettings = false

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
        .task {
            await app.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await app.syncOnForeground() }
            }
        }
        .sheet(isPresented: setupNoticeBinding) {
            SetupNoticeSheet(app: app) {
                app.dismissSetupNotice()
                showSetupSettings = true
            }
        }
        .sheet(isPresented: $showSetupSettings) {
            NavigationStack {
                MobileSettingsView(app: app)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") {
                                showSetupSettings = false
                                app.refreshSetupFlags()
                            }
                        }
                    }
            }
        }
    }

    private var setupNoticeBinding: Binding<Bool> {
        Binding(
            get: { app.showSetupNotice },
            set: { app.showSetupNotice = $0 }
        )
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

#Preview("Setup notice") {
    ContentView(
        app: {
            let app = PreviewSupport.emptyApp()
            app.showSetupNotice = true
            return app
        }()
    )
}
