import SwiftUI

enum DictationRecordingMode: Equatable {
    /// Home Dictate: create a dictation session and navigate.
    case createSession
    /// Composer mic: send transcript into an existing conversation.
    case sendToConversation(conversationId: String)
}

private enum DictationRecordingPhase: Equatable {
    case starting
    case recording
    case processing
    case failed(String)
}

struct DictationRecordingSheet: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var recordingSession: RecordingSessionManager
    let mode: DictationRecordingMode
    @Binding var isPresented: Bool
    var onConversationCreated: (String) -> Void = { _ in }
    var onTranscriptSent: (String) -> Void = { _ in }

    @State private var phase: DictationRecordingPhase = .starting
    @State private var savedAudioURL: URL?
    @State private var didAutoStart = false
    /// Invalidates in-flight stop/transcribe work when the user cancels.
    @State private var operationGeneration = 0

    init(
        app: AppModel,
        mode: DictationRecordingMode,
        isPresented: Binding<Bool>,
        onConversationCreated: @escaping (String) -> Void = { _ in },
        onTranscriptSent: @escaping (String) -> Void = { _ in }
    ) {
        self.app = app
        self.recordingSession = app.recordingSession
        self.mode = mode
        self._isPresented = isPresented
        self.onConversationCreated = onConversationCreated
        self.onTranscriptSent = onTranscriptSent
    }

    private var recorder: AudioRecorder { recordingSession.recorder }

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
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        Task { await cancelAndDismiss() }
                    }
                }
                if phase == .recording {
                    ToolbarItem(placement: .principal) {
                        HStack(spacing: 8) {
                            RecordingPulseDot()
                            Text(formattedElapsed(recorder.elapsedMs))
                                .font(.system(.body, design: .monospaced).weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(.primary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Recording duration")
                        .accessibilityValue(formattedElapsed(recorder.elapsedMs))
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
        .onChange(of: recordingSession.liveActivityStopRequested) { _, requested in
            guard requested else { return }
            recordingSession.acknowledgeLiveActivityStopRequest()
            Task { await stopAndTranscribe() }
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

    private var navigationTitle: String {
        switch phase {
        case .recording, .processing:
            return ""
        default:
            return "Dictate"
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
        VStack(spacing: 36) {
            LiveAudioWaveformView(
                samples: recorder.waveformSamples,
                level: recorder.audioLevel,
                color: .red
            )
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)

            HStack(spacing: 28) {
                Button {
                    HapticFeedback.warning()
                    Task { await cancelAndDismiss() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 52, height: 52)
                        .background(Circle().fill(Color.primary.opacity(0.1)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel recording")

                Button {
                    HapticFeedback.success()
                    Task { await stopAndTranscribe() }
                } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 96, height: 96)
                        .background(Circle().fill(Color.accentColor))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop and transcribe")
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
            _ = try await recordingSession.beginRecordingSession()
            // Cancel may have completed between start returning and this resume.
            guard recorder.isRecording else {
                if isPresented {
                    isPresented = false
                }
                return
            }
            phase = .recording
        } catch is CancellationError {
            // Cancelled mid-start; session manager already tore down. Avoid a stuck "Starting…" UI
            // if cancellation came from task teardown rather than the Cancel button.
            if isPresented {
                isPresented = false
            }
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func stopAndTranscribe() async {
        guard phase == .recording else { return }
        let generation = operationGeneration
        do {
            let url = try recorder.stop()
            await recordingSession.endRecordingSession()
            guard generation == operationGeneration else { return }
            savedAudioURL = url
            phase = .processing
            try await OnDeviceTranscriber.ensureAudioFileReady(at: url)
            guard generation == operationGeneration else { return }
            await transcribeSavedAudio()
        } catch {
            await recordingSession.endRecordingSession()
            guard generation == operationGeneration else { return }
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
            switch mode {
            case .createSession:
                let conversationId = try app.createDictationConversation(
                    userMessage: transcript,
                    recordingURL: audioURL
                )
                isPresented = false
                onConversationCreated(conversationId)
            case .sendToConversation(let conversationId):
                try DictationRecordingIndex.link(conversationId: conversationId, recordingURL: audioURL)
                isPresented = false
                onTranscriptSent(transcript)
            }
        } catch is CancellationError {
            phase = .failed("Transcription cancelled. Your recording is still saved on this device.")
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func cancelAndDismiss() async {
        operationGeneration += 1
        app.dictationService.cancel()
        await recordingSession.cancelRecordingSession()
        isPresented = false
    }

    private func formattedElapsed(_ ms: Int) -> String {
        let totalSeconds = ms / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        let tenths = (ms % 1000) / 100
        return String(format: "%d:%02d.%d", minutes, seconds, tenths)
    }
}

private struct RecordingPulseDot: View {
    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(Color.red)
            .frame(width: 6, height: 6)
            .opacity(isPulsing ? 0.35 : 1)
            .animation(
                .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear { isPulsing = true }
            .accessibilityHidden(true)
    }
}

#Preview("Recording") {
    DictationRecordingSheet(
        app: PreviewSupport.emptyApp(syncNotConfigured: false, needsAPIKey: false),
        mode: .createSession,
        isPresented: .constant(true),
        onConversationCreated: { _ in }
    )
}
