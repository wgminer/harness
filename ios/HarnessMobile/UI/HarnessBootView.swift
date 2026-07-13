import SwiftUI

struct HarnessBootView: View {
    @Environment(\.harnessTheme) private var theme

    var body: some View {
        ZStack {
            theme.bgColor.ignoresSafeArea()
            Text("Harness")
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(theme.fgColor)
        }
        .accessibilityLabel("Harness")
    }
}

#Preview {
    HarnessBootView()
        .environment(\.harnessTheme, .default)
        .preferredColorScheme(.dark)
}
