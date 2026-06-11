import SwiftUI
import UIKit

struct RecordingShareButton: View {
    let recordingURL: URL
    var label: String = "Save recording"
    var systemImage: String = "square.and.arrow.up"
    var iconOnly = false

    @State private var showShareSheet = false

    var body: some View {
        Button {
            showShareSheet = true
        } label: {
            if iconOnly {
                Image(systemName: systemImage)
            } else {
                Label(label, systemImage: systemImage)
            }
        }
        .accessibilityLabel(label)
        .sheet(isPresented: $showShareSheet) {
            ActivityShareSheet(items: [recordingURL])
        }
    }
}

struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

struct DictationRecordingAccessBar: View {
    let recordingURL: URL
    var detail: String = "Your recording is saved on this device."

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                RecordingShareButton(
                    recordingURL: recordingURL,
                    label: "Share or save",
                    systemImage: "square.and.arrow.up"
                )
                .buttonStyle(.bordered)

                RecordingShareButton(
                    recordingURL: recordingURL,
                    label: "Play in…",
                    systemImage: "play.circle"
                )
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

#Preview("Recording access") {
    DictationRecordingAccessBar(
        recordingURL: URL(fileURLWithPath: "/tmp/rec_test.m4a")
    )
    .padding()
}
