import SwiftUI

struct HarnessBootView: View {
    var body: some View {
        ZStack {
            HarnessPalette.background.ignoresSafeArea()
            Text("Harness")
                .font(.title2)
                .foregroundStyle(HarnessPalette.textMuted)
        }
        .accessibilityLabel("Harness")
    }
}

#Preview {
    HarnessBootView()
}
