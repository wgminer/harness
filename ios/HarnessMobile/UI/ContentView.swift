import SwiftUI

struct ContentView: View {
    @StateObject private var app: AppModel
    @StateObject private var chatRouter: ChatRouter
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSetupSettings = false

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
            if phase == .active {
                Task { await app.syncOnForeground() }
            } else if phase == .background {
                app.flushComposerDrafts()
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

    private var mainNavigation: some View {
        NavigationStack {
            // Equatable isolation: chatRouter route changes must not rebuild the list.
            ConversationListIsolation(app: app)
                .equatable()
                .navigationDestination(item: chatRouteBinding) { route in
                    switch route {
                    case .compose:
                        ComposeChatView(app: app)
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
            set: { newValue in
                if newValue == nil, case .compose = chatRouter.route {
                    app.clearComposeDraft()
                }
                chatRouter.route = newValue
            }
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
