import SwiftUI
import UIKit

@main
struct HarnessMobileApp: App {
    init() {
        Self.configureNavigationBarAppearance()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
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
