import SwiftUI

struct HarnessBootView: View {
    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            Text("Harness")
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .accessibilityLabel("Harness")
    }
}

#Preview {
    HarnessBootView()
}
