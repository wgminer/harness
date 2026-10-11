import SwiftUI

struct ContentView: View {
    /// Owned by `HarnessMobileApp` so a rebuilt scene keeps the open thread and dictation.
    @ObservedObject private var app: AppModel
    @ObservedObject private var chatRouter: ChatRouter
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSetupPairing = false
    /// The list opens half height so a short swipe down returns to capture; threads take the full sheet.
    @State private var listDetent: PresentationDetent = .medium

    init(app: AppModel, chatRouter: ChatRouter? = nil, initialChatRoute: ChatRoute? = nil) {
        self.app = app
        let router = chatRouter ?? ChatRouter()
        if let initialChatRoute {
            router.route = initialChatRoute
            router.listOpen = true
            _listDetent = State(initialValue: .large)
        }
        self.chatRouter = router
    }

    var body: some View {
        // The capture home draws immediately; it never waits on the conversation list.
        CaptureHomeView(
            app: app,
            isCapturing: app.activeDictation == .createSession,
            onOpenList: { chatRouter.listOpen = true }
        )
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
        .sheet(isPresented: $chatRouter.listOpen) {
            listSheet
                .presentationDetents([.medium, .large], selection: $listDetent)
                .presentationDragIndicator(.visible)
                .presentationBackground(HarnessPalette.background)
        }
        .onChange(of: chatRouter.listOpen) { _, open in
            if open { listDetent = chatRouter.route == nil ? .medium : .large }
        }
        .onChange(of: chatRouter.route) { _, route in
            if route != nil { listDetent = .large }
        }
    }

    /// Captures, chats, tasks, and settings; a thread's composer mic records in its own sheet.
    private var listSheet: some View {
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
        .sheet(isPresented: threadDictationPresented) {
            if case .sendToConversation(let conversationId) = app.activeDictation {
                DictationRecordingSheet(
                    app: app,
                    mode: .sendToConversation(conversationId: conversationId),
                    isPresented: threadDictationPresented,
                    onTranscriptSent: { transcript in
                        app.finishThreadDictation(transcript: transcript)
                    }
                )
            }
        }
    }

    private var threadDictationPresented: Binding<Bool> {
        Binding(
            get: {
                if case .sendToConversation = app.activeDictation { return true }
                return false
            },
            set: { if !$0 { app.dismissDictation() } }
        )
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

#Preview("Capture home") {
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
