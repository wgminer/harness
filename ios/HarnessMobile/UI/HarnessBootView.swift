import SwiftUI

struct HarnessBootView: View {
    var body: some View {
        ZStack {
            HarnessPalette.background.ignoresSafeArea()
            Text("Harness")
                .font(.system(.title2, design: .serif))
                .foregroundStyle(HarnessPalette.textMuted)
        }
        .accessibilityLabel("Harness")
    }
}

#Preview {
    HarnessBootView()
}
