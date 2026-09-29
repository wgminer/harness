import SwiftUI
import UIKit

@main
struct HarnessMobileApp: App {
    /// Process-lifetime, not scene-lifetime: a Live Activity intent can reopen the app into a
    /// fresh scene, which must land back in the same thread and recording session.
    @StateObject private var app = AppModel()
    @StateObject private var chatRouter = ChatRouter()

    init() {
        Self.configureNavigationBarAppearance()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(app: app, chatRouter: chatRouter)
                .preferredColorScheme(.dark)
                .tint(HarnessPalette.accent)
        }
    }

    /// Titles in `--fg` at a calm weight; hairline shadow in `--border-edge`.
    private static func configureNavigationBarAppearance() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(HarnessPalette.background)
        appearance.shadowColor = UIColor(HarnessPalette.separator)
        appearance.titleTextAttributes = [
            .foregroundColor: UIColor(HarnessPalette.text),
            .font: UIFont.systemFont(ofSize: 16, weight: .semibold),
        ]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
    }
}

#Preview("App root") {
    ContentView(app: PreviewSupport.populatedApp())
        .preferredColorScheme(.dark)
        .tint(HarnessPalette.accent)
}
