import SwiftUI

private enum DictationRecordingPhase: Equatable {
    case starting
    case recording
    case processing
    case failed(String)
}

struct DictationRecordingSheet: View {
    @ObservedObject var app: AppModel
    @Binding var isPresented: Bool
    var onConversationCreated: (String) -> Void

    @StateObject private var recorder = AudioRecorder()
    @State private var phase: DictationRecordingPhase = .starting
    @State private var savedAudioURL: URL?
    @State private var didAutoStart = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                switch phase {
                case .starting:
                    startingContent
                        .padding(.horizontal, 28)
                case .recording:
                    recordingContent
                case .processing:
                    processingContent
                        .padding(.horizontal, 28)
                case .failed(let message):
                    failedContent(message: message)
                        .padding(.horizontal, 28)
                }

                Spacer()
            }
            .padding(.bottom, 32)
            .navigationTitle(phase == .processing ? "" : "Dictate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if phase != .processing {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            cancelActiveWork()
                            isPresented = false
                        }
                    }
                }
            }
        }
        .interactiveDismissDisabled(isRecordingOrProcessing)
        .task {
            guard !didAutoStart else { return }
            didAutoStart = true
            await startRecording()
        }
        .onChange(of: recorder.elapsedMs) { _, ms in
            if ms >= Int(RecordingStorage.maxRecordingDuration * 1000), phase == .recording {
                Task { await stopAndTranscribe() }
            }
        }
    }

    private var isRecordingOrProcessing: Bool {
        switch phase {
        case .recording, .processing, .starting:
            return true
        default:
            return false
        }
    }

    private var startingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Starting microphone…")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private var recordingContent: some View {
        VStack(spacing: 20) {
            LiveAudioWaveformView(samples: recorder.waveformSamples, barColor: .red)
                .frame(maxWidth: .infinity)
                .ignoresSafeArea(edges: .horizontal)

            VStack(spacing: 20) {
                Text(formattedElapsed(recorder.elapsedMs))
                    .font(.system(.title, design: .monospaced))
                    .foregroundStyle(.primary)

                if recorder.audioLevel < 0.12 {
                    Text("Listening… speak now.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 20) {
                    Button {
                        cancelActiveWork()
                        isPresented = false
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 20, weight: .bold))
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Color.primary.opacity(0.1)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel recording")

                    Button {
                        Task { await stopAndTranscribe() }
                    } label: {
                        Image(systemName: "checkmark")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 72, height: 72)
                            .background(Circle().fill(Color.accentColor))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Stop and transcribe")
                }
            }
            .padding(.horizontal, 28)
        }
    }

    private var processingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Transcribing…")
                .font(.headline)
                .foregroundStyle(.secondary)
        }
    }

    private func failedContent(message: String) -> some View {
        VStack(spacing: 16) {
            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let savedAudioURL {
                DictationRecordingAccessBar(
                    recordingURL: savedAudioURL,
                    detail: "Your recording was not lost. Share or save it, then retry transcription when ready."
                )
            }

            if savedAudioURL != nil {
                Button("Retry transcription") {
                    Task { await retryTranscription() }
                }
                .buttonStyle(.borderedProminent)
            }

            Button("Record again") {
                savedAudioURL = nil
                phase = .starting
                didAutoStart = false
                Task { await startRecording() }
            }
            .buttonStyle(.bordered)
        }
    }

    private func startRecording() async {
        phase = .starting
        do {
            _ = try await recorder.start()
            phase = .recording
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func stopAndTranscribe() async {
        guard phase == .recording else { return }
        do {
            let url = try recorder.stop()
            savedAudioURL = url
            phase = .processing
            try await OnDeviceTranscriber.ensureAudioFileReady(at: url)
            await transcribeSavedAudio()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func retryTranscription() async {
        guard let savedAudioURL else {
            phase = .starting
            return
        }
        phase = .processing
        await transcribeSavedAudio(reusing: savedAudioURL)
    }

    private func transcribeSavedAudio(reusing url: URL? = nil) async {
        guard let audioURL = url ?? savedAudioURL else {
            phase = .failed("No saved recording found.")
            return
        }

        do {
            let transcript = try await app.dictationService.transcribeRecording(at: audioURL)
            let conversationId = try app.createDictationConversation(
                userMessage: transcript,
                recordingURL: audioURL
            )
            isPresented = false
            onConversationCreated(conversationId)
        } catch is CancellationError {
            phase = .failed("Transcription cancelled. Your recording is still saved on this device.")
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func cancelActiveWork() {
        app.dictationService.cancel()
        if recorder.isRecording {
            recorder.cancel()
        }
    }

    private func formattedElapsed(_ ms: Int) -> String {
        let totalSeconds = ms / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        let milliseconds = ms % 1000
        return String(format: "%d:%02d.%03d", minutes, seconds, milliseconds)
    }
}

#Preview("Recording") {
    DictationRecordingSheet(
        app: PreviewSupport.emptyApp(needsBackupFolder: false, needsAPIKey: false),
        isPresented: .constant(true),
        onConversationCreated: { _ in }
    )
}
