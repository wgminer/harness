import SwiftUI

struct ContentView: View {
    @StateObject private var app: AppModel
    @StateObject private var chatRouter: ChatRouter
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSetupPairing = false

    init(app: AppModel? = nil, initialChatRoute: ChatRoute? = nil) {
        _app = StateObject(wrappedValue: app ?? AppModel())
        let router = ChatRouter()
        router.route = initialChatRoute
        _chatRouter = StateObject(wrappedValue: router)
    }

    var body: some View {
        ZStack {
            if app.hasCompletedInitialLoad {
                mainNavigation
                    .transition(.opacity)
            } else {
                HarnessBootView()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: app.hasCompletedInitialLoad)
        .task {
            app.chatRouter = chatRouter
            await app.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await app.syncOnForeground() }
            case .background:
                app.markEnteredBackground()
            default:
                break
            }
        }
        .sheet(isPresented: setupNoticeBinding) {
            SetupNoticeSheet(app: app) {
                app.dismissSetupNotice()
                showSetupPairing = true
            }
        }
        .sheet(isPresented: $showSetupPairing) {
            SyncPairingSheet(app: app, isPresented: $showSetupPairing) {
                app.refreshSetupFlags()
            }
        }
        .sheet(isPresented: dictationPresented) {
            DictationRecordingSheet(
                app: app,
                mode: dictationMode,
                isPresented: dictationPresented,
                onConversationCreated: { conversationId in
                    app.dismissDictation()
                    app.openThread(id: conversationId)
                },
                onTranscriptSent: { transcript in
                    app.finishThreadDictation(transcript: transcript)
                }
            )
        }
    }

    private var dictationPresented: Binding<Bool> {
        Binding(
            get: { app.activeDictation != nil },
            set: { if !$0 { app.dismissDictation() } }
        )
    }

    private var dictationMode: DictationRecordingMode {
        switch app.activeDictation {
        case .sendToConversation(let id):
            return .sendToConversation(conversationId: id)
        case .createSession, .none:
            return .createSession
        }
    }

    private var mainNavigation: some View {
        NavigationStack {
            // Equatable isolation: chatRouter route changes must not rebuild the list.
            ConversationListIsolation(app: app)
                .equatable()
                .navigationDestination(item: chatRouteBinding) { route in
                    switch route {
                    case .thread(let conversationId):
                        ChatThreadView(app: app, conversationId: conversationId)
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
            get: { chatRouter.route },
            set: { chatRouter.route = $0 }
        )
    }
}

/// Skips body updates when only unrelated parent state (e.g. chat route) changed.
private struct ConversationListIsolation: View, Equatable {
    let app: AppModel

    static func == (lhs: ConversationListIsolation, rhs: ConversationListIsolation) -> Bool {
        lhs.app === rhs.app
    }

    var body: some View {
        ConversationListView(app: app) { conversationId in
            app.openThread(id: conversationId)
        }
    }
}

#Preview("Conversation list") {
    ContentView(app: PreviewSupport.populatedApp())
}

#Preview("Chat thread") {
    ContentView(
        app: PreviewSupport.populatedApp(),
        initialChatRoute: .thread(id: PreviewSupport.sampleConversationId)
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

#Preview("Boot") {
    ContentView(app: AppModel(localDataSubpath: "preview-boot-\(UUID().uuidString)"))
}
