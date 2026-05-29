import SwiftUI

@main
struct HarnessMobileApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

#Preview("App root") {
    ContentView(app: PreviewSupport.populatedApp())
}
