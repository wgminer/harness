import SwiftUI

struct SetupNoticeSheet: View {
    @ObservedObject var app: AppModel
    let onConfigure: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(
                        "Chat needs an OpenAI key from your Mac. Scan the sync QR to pull credentials and back up this phone."
                    )
                    .font(.body)
                    .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .navigationTitle("Welcome to Here")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Scan QR code") {
                        onConfigure()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Not now") {
                        app.dismissSetupNotice()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

#Preview {
    SetupNoticeSheet(app: PreviewSupport.emptyApp()) {}
}
