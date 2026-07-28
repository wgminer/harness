import SwiftUI

struct HarnessBootView: View {
    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            Text("Here")
                .font(.largeTitle.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .accessibilityLabel("Here")
    }
}

#Preview {
    HarnessBootView()
}
