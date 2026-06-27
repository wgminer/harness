import SwiftUI

struct SetupNoticeSheet: View {
    @ObservedObject var app: AppModel
    let onConfigure: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(
                        "Harness works locally on your device. Chat and other AI features need an OpenAI API key. Cloud sync is optional — connect R2 when you want to pull data from another device."
                    )
                    .font(.body)
                    .foregroundStyle(.secondary)

                    if app.needsAPIKey {
                        setupSection(
                            heading: "Required for chat",
                            title: "OpenAI API key",
                            detail: "Chat, polish, and optional transcript cleanup need an API key."
                        )
                    }

                    if app.syncNotConfigured {
                        setupSection(
                            heading: app.needsAPIKey ? "Recommended" : "Optional",
                            title: "Cloud sync (R2)",
                            detail: "Connect the same R2 bucket as Harness desktop to sync conversations and settings across devices."
                        )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .navigationTitle("Welcome to Harness")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Configure") {
                        onConfigure()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Got it") {
                        app.dismissSetupNotice()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func setupSection(heading: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(heading)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

#Preview {
    SetupNoticeSheet(app: PreviewSupport.emptyApp()) {}
}
