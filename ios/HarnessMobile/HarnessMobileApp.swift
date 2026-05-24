import SwiftUI

@main
struct HarnessMobileApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

#Preview("App root") {
    ContentView(app: PreviewSupport.populatedApp())
}
