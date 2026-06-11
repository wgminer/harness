import SwiftUI
import UniformTypeIdentifiers

struct VoiceMemoImportSheet: View {
    @ObservedObject var app: AppModel
    @Binding var isPresented: Bool
    var onConversationCreated: (String) -> Void

    @State private var phase: ImportPhase = .pick
    @State private var errorMessage: String?
    @State private var showFilePicker = false
    @State private var statusDetail: String?

    private enum ImportPhase: Equatable {
        case pick
        case processing
        case failed(String)
    }

    private var isProcessing: Bool {
        if case .processing = phase { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                switch phase {
                case .pick:
                    pickContent
                case .processing:
                    processingContent
                case .failed(let message):
                    failedContent(message: message)
                }

                Spacer()
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 32)
            .navigationTitle("Import Voice Memo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        app.dictationService.cancel()
                        isPresented = false
                    }
                }
            }
        }
        .interactiveDismissDisabled(isProcessing)
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.mpeg4Audio, .audio, .wav, UTType(filenameExtension: "qta") ?? .data],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                Task { await importVoiceMemo(from: url) }
            case .failure(let error):
                phase = .failed(error.localizedDescription)
            }
        }
    }

    private var pickContent: some View {
        VStack(spacing: 20) {
            Image(systemName: "waveform.badge.mic")
                .font(.system(size: 48))
                .foregroundStyle(.red)

            Text("Import from Voice Memos")
                .font(.title3.weight(.semibold))

            Text(
                "Select a recording from Files. If Apple has already transcribed it in Voice Memos, Harness uses that text on-device — no cloud API needed."
            )
            .font(.body)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: 8) {
                Label("Open Voice Memos → share → Save to Files, or pick from iCloud Drive.", systemImage: "1.circle")
                Label("Harness reads Apple's embedded transcript when available.", systemImage: "2.circle")
                Label("Otherwise on-device Speech recognition is used, then Whisper if you have an API key.", systemImage: "3.circle")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button("Choose recording") {
                showFilePicker = true
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    private var processingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Importing…")
                .font(.headline)
            if let statusDetail {
                Text(statusDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button("Cancel") {
                app.dictationService.cancel()
                phase = .failed("Import cancelled.")
            }
            .font(.subheadline)
        }
    }

    private func failedContent(message: String) -> some View {
        VStack(spacing: 16) {
            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Try again") {
                phase = .pick
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func importVoiceMemo(from pickedURL: URL) async {
        phase = .processing
        statusDetail = "Copying audio…"

        let accessed = pickedURL.startAccessingSecurityScopedResource()
        defer {
            if accessed { pickedURL.stopAccessingSecurityScopedResource() }
        }

        do {
            let localURL = try RecordingStorage.importRecording(from: pickedURL)

            statusDetail = "Looking for Apple transcript…"
            let result = try await app.dictationService.transcribeRecordingDetailed(
                at: localURL,
                preferEmbeddedTranscript: true
            )

            statusDetail = transcriptionStatus(for: result.source)
            let conversationId = try app.store.createDictationConversation(
                userMessage: result.text,
                recordingURL: localURL
            )
            if app.dictationService.loadSettings().autoSend {
                app.markPendingAutoGenerateReply(conversationId: conversationId)
            }
            isPresented = false
            onConversationCreated(conversationId)
        } catch is CancellationError {
            phase = .failed("Import cancelled.")
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func transcriptionStatus(for source: TranscriptionSource) -> String {
        switch source {
        case .appleEmbedded:
            return "Using Apple's Voice Memos transcript."
        case .onDevice:
            return "Transcribing on-device with Apple Speech…"
        case .whisperAPI:
            return "Transcribing with Whisper…"
        }
    }
}

#Preview("Import") {
    VoiceMemoImportSheet(
        app: PreviewSupport.emptyApp(needsBackupFolder: false, needsAPIKey: false),
        isPresented: .constant(true),
        onConversationCreated: { _ in }
    )
}
