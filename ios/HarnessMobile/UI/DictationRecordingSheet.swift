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
    /// Not observed — AppModel publishes sync/setup churn that must not rebuild the sheet.
    let app: AppModel
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
    /// Latch so only one stop path (button / Live Activity / max duration) owns the stop.
    @State private var isStopping = false
    @State private var showFailedRecordingShareSheet = false

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
        // Fast boot: skip the spinner chrome when mic permission is already granted.
        if app.recordingSession.hasRecordPermission {
            self._phase = State(initialValue: .recording)
        }
    }

    private var recorder: AudioRecorder { recordingSession.recorder }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                switch phase {
                case .starting:
                    Spacer()
                    startingContent
                        .padding(.horizontal, 28)
                    Spacer()
                case .recording:
                    Spacer()
                    recordingContent
                    DictationCaptureWatchdog(
                        recorder: recorder,
                        onUnexpectedEnd: {
                            // Only fail while we still believe capture is live.
                            // A stale onChange can fire after stop has already moved us on.
                            guard phase == .recording, !isStopping else { return }
                            // Take ownership so a later start()/cancel won't delete this file.
                            if savedAudioURL == nil {
                                savedAudioURL = recorder.consumePreservedRecordingURL()
                            }
                            phase = .failed(
                                AudioRecorderError.interrupted.errorDescription
                                    ?? "Recording was interrupted."
                            )
                            Task { await recordingSession.endRecordingSession() }
                        }
                    )
                    Spacer()
                case .processing:
                    Spacer()
                    processingContent
                        .padding(.horizontal, 28)
                    Spacer()
                case .failed(let message):
                    failedContent(message: message)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
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
            }
        }
        .interactiveDismissDisabled(isRecordingOrProcessing)
        .sheet(isPresented: $showFailedRecordingShareSheet) {
            if let savedAudioURL {
                ActivityShareSheet(items: [savedAudioURL])
            }
        }
        .task {
            guard !didAutoStart else { return }
            didAutoStart = true
            await startRecording()
        }
        .onChange(of: recordingSession.liveActivityStopRequested) { _, requested in
            guard requested else { return }
            recordingSession.acknowledgeLiveActivityStopRequest()
            Task { await stopAndTranscribe() }
        }
        .onDisappear {
            // Swipe-dismiss (allowed from .failed) must invalidate any in-flight transcribe
            // so a background winner cannot commit a conversation after the user left.
            operationGeneration += 1
            app.dictationService.cancel()
            // Failed takes are UI-owned after consume; delete on abandon so they do not orphan.
            if case .failed = phase, let url = savedAudioURL {
                try? FileManager.default.removeItem(at: url)
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
            // Observe AudioRecorder in a leaf so metering does not rebuild the sheet chrome.
            VStack(spacing: 12) {
                DictationWaveformHost(recorder: recorder)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)

                DictationElapsedLabel(
                    recorder: recorder,
                    onMaxDuration: {
                        Task { await stopAndTranscribe() }
                    }
                )
            }

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
                .disabled(!recorder.isRecording)
                .opacity(recorder.isRecording ? 1 : 0.45)
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

    private var canUseWhisper: Bool {
        savedAudioURL != nil && app.dictationService.hasWhisperAPIKey
    }

    private func failedContent(message: String) -> some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "waveform.badge.exclamationmark")
        } description: {
            VStack(spacing: 8) {
                Text(message)
                if savedAudioURL != nil {
                    Text(
                        canUseWhisper
                            ? "Your recording is still saved. Retry on-device, or use Whisper."
                            : "Your recording is still saved. Open it to keep a copy, or retry transcription."
                    )
                    .foregroundStyle(.secondary)
                }
            }
        } actions: {
            if savedAudioURL != nil {
                Button("Retry Transcription") {
                    Task { await retryTranscription() }
                }
                .buttonStyle(.borderedProminent)

                if canUseWhisper {
                    Button("Use Whisper") {
                        Task { await transcribeWithWhisper() }
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    showFailedRecordingShareSheet = true
                } label: {
                    Label("Open Recording", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.bordered)
            }

            Button("Record Again") {
                if let savedAudioURL {
                    try? FileManager.default.removeItem(at: savedAudioURL)
                }
                savedAudioURL = nil
                showFailedRecordingShareSheet = false
                phase = recordingSession.hasRecordPermission ? .recording : .starting
                didAutoStart = false
                Task { await startRecording() }
            }
        }
    }

    private func startRecording() async {
        isStopping = false
        // Keep optimistic recording chrome when permission is already granted.
        if !recordingSession.hasRecordPermission {
            phase = .starting
        } else if phase != .recording {
            phase = .recording
        }

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
            // Distinct from the mic-open tap: confirms the session is actually live.
            HapticFeedback.medium()
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
        guard phase == .recording, !isStopping else {
            return
        }
        isStopping = true
        let generation = operationGeneration
        let peakLevel = recorder.peakLevelDuringSession
        let elapsedSeconds = TimeInterval(recorder.elapsedMs) / 1000.0

        do {
            let url = try recorder.stop()
            await recordingSession.endRecordingSession()
            guard generation == operationGeneration else { return }
            savedAudioURL = url
            phase = .processing

            let failure = RecordingCaptureValidation.validate(
                url: url,
                peakLevelDuringSession: peakLevel,
                // Prefer wall-clock elapsed — AVURLAsset.duration can be nil right after finalize.
                duration: elapsedSeconds > 0 ? elapsedSeconds : nil
            )
            if let failure {
                phase = .failed(RecordingCaptureValidation.userMessage(for: failure))
                return
            }

            await transcribeSavedAudio()
        } catch {
            await recordingSession.endRecordingSession()
            guard generation == operationGeneration else { return }
            // A losing concurrent stop must not overwrite the winner's UI with a failure.
            if case AudioRecorderError.notRecording = error {
                return
            }
            phase = .failed(error.localizedDescription)
        }
    }

    private func retryTranscription() async {
        guard let savedAudioURL else {
            phase = recordingSession.hasRecordPermission ? .recording : .starting
            return
        }
        phase = .processing
        await transcribeSavedAudio(reusing: savedAudioURL, engine: .onDevice)
    }

    private func transcribeWithWhisper() async {
        guard let savedAudioURL else { return }
        phase = .processing
        await transcribeSavedAudio(reusing: savedAudioURL, engine: .whisper)
    }

    private func transcribeSavedAudio(
        reusing url: URL? = nil,
        engine: TranscriptionEngine = .onDevice
    ) async {
        guard let audioURL = url ?? savedAudioURL else {
            phase = .failed("No saved recording found.")
            return
        }
        let generation = operationGeneration

        do {
            let transcript: String
            switch engine {
            case .onDevice:
                transcript = try await app.dictationService.transcribeRecording(at: audioURL)
            case .whisper:
                transcript = try await app.dictationService.transcribeRecordingWithWhisper(at: audioURL)
            }
            // Cancel / dismiss while transcribing must not commit a conversation afterwards.
            guard generation == operationGeneration else {
                return
            }
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
            guard generation == operationGeneration else { return }
            phase = .failed("Transcription was cancelled.")
        } catch {
            guard generation == operationGeneration else { return }
            phase = .failed(error.localizedDescription)
        }
    }

    private func cancelAndDismiss() async {
        operationGeneration += 1
        app.dictationService.cancel()
        await recordingSession.cancelRecordingSession()
        if let url = savedAudioURL {
            try? FileManager.default.removeItem(at: url)
            savedAudioURL = nil
        }
        isPresented = false
    }
}

private enum DictationElapsedFormatting {
    static func string(ms: Int) -> String {
        let totalSeconds = ms / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        let tenths = (ms % 1000) / 100
        return String(format: "%d:%02d.%d", minutes, seconds, tenths)
    }
}

/// Isolates AudioRecorder observation so metering does not rebuild the sheet body.
private struct DictationWaveformHost: View {
    @ObservedObject var recorder: AudioRecorder

    var body: some View {
        LiveAudioWaveformView(level: recorder.audioLevel)
            .frame(maxWidth: .infinity)
            .frame(height: 320)
    }
}

/// Observes capture drops from interruption / media-reset without rebuilding sheet chrome on metering.
private struct DictationCaptureWatchdog: View {
    @ObservedObject var recorder: AudioRecorder
    var onUnexpectedEnd: () -> Void

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onChange(of: recorder.isRecording) { _, isRecording in
                // Read intentionalStop from the recorder object at callback time —
                // a SwiftUI `let expectRecordingEnd` can still be stale here.
                let intentional = recorder.intentionalStop
                guard !isRecording, !intentional else { return }
                onUnexpectedEnd()
            }
    }
}

private struct DictationElapsedLabel: View {
    @ObservedObject var recorder: AudioRecorder
    var onMaxDuration: () -> Void
    /// Elapsed keeps ticking past the limit; fire the stop exactly once.
    @State private var didFireMaxDuration = false

    var body: some View {
        Text(DictationElapsedFormatting.string(ms: recorder.elapsedMs))
            .font(.body.weight(.medium))
            .monospacedDigit()
            .foregroundStyle(.primary)
            .accessibilityLabel("Recording duration")
            .accessibilityValue(DictationElapsedFormatting.string(ms: recorder.elapsedMs))
            .onChange(of: recorder.elapsedMs) { _, ms in
                if ms >= Int(RecordingStorage.maxRecordingDuration * 1000), !didFireMaxDuration {
                    didFireMaxDuration = true
                    onMaxDuration()
                }
            }
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
