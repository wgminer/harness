import SwiftUI

enum DictationRecordingMode: Equatable {
    /// Home record button or record-on-launch: save the take as a dictation session.
    case createSession
    /// Composer mic: send transcript into an existing conversation.
    case sendToConversation(conversationId: String)
}

enum DictationRecordingStyle {
    /// Modal sheet with navigation chrome; used from a thread's composer.
    case sheet
    /// Chromeless, drawn straight onto the capture home so recording starts with no transition.
    case immersive
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
    let style: DictationRecordingStyle
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
    /// Local mic-live latch — parent does not observe AudioRecorder for meter churn.
    @State private var isMicLive = false

    init(
        app: AppModel,
        mode: DictationRecordingMode,
        style: DictationRecordingStyle = .sheet,
        isPresented: Binding<Bool>,
        onConversationCreated: @escaping (String) -> Void = { _ in },
        onTranscriptSent: @escaping (String) -> Void = { _ in }
    ) {
        self.app = app
        self.recordingSession = app.recordingSession
        self.mode = mode
        self.style = style
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
        Group {
            switch style {
            case .sheet:
                sheetChrome
                    .presentationBackground(HarnessPalette.background)
                    .interactiveDismissDisabled(isRecordingOrProcessing)
            case .immersive:
                immersiveChrome
            }
        }
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
            operationGeneration += 1
            app.dictationService.cancel()
            if case .failed = phase, let url = savedAudioURL {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    private var sheetChrome: some View {
        NavigationStack {
            VStack(spacing: 24) {
                switch phase {
                case .starting:
                    centeredStatus { startingContent }
                case .recording:
                    Spacer()
                    recordingContent
                    DictationCaptureWatchdog(recorder: recorder, onUnexpectedEnd: handleUnexpectedEnd)
                    Spacer()
                case .processing:
                    centeredStatus { processingContent }
                case .failed(let message):
                    failedContent(message: message)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HarnessPalette.background.ignoresSafeArea())
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        Task { await cancelAndDismiss() }
                    }
                    .foregroundStyle(HarnessPalette.textMuted)
                }
            }
        }
    }

    /// No navigation bar, no sheet: timer and ridgeline straight on the page background.
    private var immersiveChrome: some View {
        GeometryReader { proxy in
            immersiveLayout(insets: proxy.safeAreaInsets)
        }
    }

    private func immersiveLayout(insets: EdgeInsets) -> some View {
        ZStack {
            switch phase {
            case .starting:
                immersiveStatus("Starting microphone…")
            case .recording:
                // Centered on the physical screen, so the ring lands exactly on the idle circle.
                CaptureVisualizer(recorder: recorder)
                    .frame(maxWidth: .infinity)
                    .frame(height: 380)
                    .offset(y: CaptureRing.centerShift(insets))
                    .background {
                        DictationCaptureWatchdog(recorder: recorder, onUnexpectedEnd: handleUnexpectedEnd)
                    }
            case .processing:
                immersiveStatus("Transcribing…")
            case .failed(let message):
                failedContent(message: message)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .top) {
            if phase == .recording {
                DictationElapsedLabel(
                    recorder: recorder,
                    font: .system(size: 52, weight: .light),
                    onMaxDuration: {
                        Task { await stopAndTranscribe() }
                    }
                )
                .frame(height: Self.timerHeight)
                .padding(.top, timerTopPadding(insets: insets))
            }
        }
        .overlay(alignment: .bottom) {
            // All controls share one row at the bottom, in thumb reach.
            ZStack {
                if phase == .recording {
                    Button {
                        HapticFeedback.success()
                        Task { await stopAndTranscribe() }
                    } label: {
                        CaptureShutter()
                    }
                    .buttonStyle(.plain)
                    .disabled(!isMicLive)
                    .opacity(isMicLive ? 1 : 0.5)
                    .accessibilityLabel("Stop and save")
                }
                HStack {
                    Button {
                        HapticFeedback.warning()
                        Task { await cancelAndDismiss() }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(HarnessPalette.textMuted)
                            .frame(width: 56, height: 56)
                            .background(Circle().fill(HarnessPalette.control))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(phase == .recording ? "Discard recording" : "Close")
                    Spacer()
                }
                .padding(.horizontal, 32)
            }
            .frame(height: CaptureShutter.diameter)
            .padding(.bottom, CaptureShutter.bottomInset)
        }
    }

    private static let timerHeight: CGFloat = 62

    /// Puts the timer as far from the top of the screen as the stop control is from the bottom.
    private func timerTopPadding(insets: EdgeInsets) -> CGFloat {
        let footerCenter = insets.bottom + CaptureShutter.bottomInset + CaptureShutter.diameter / 2
        return max(8, footerCenter - insets.top - Self.timerHeight / 2)
    }

    private func immersiveStatus(_ text: String) -> some View {
        Text(text)
            .font(.title3)
            .foregroundStyle(HarnessPalette.textMuted)
    }

    private func handleUnexpectedEnd() {
        guard phase == .recording, !isStopping else { return }
        isMicLive = false
        if savedAudioURL == nil {
            savedAudioURL = recorder.consumePreservedRecordingURL()
        }
        phase = .failed(
            AudioRecorderError.interrupted.errorDescription
                ?? "Recording was interrupted."
        )
        Task { await recordingSession.endRecordingSession() }
    }

    private func centeredStatus<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack {
            Spacer()
            content()
                .padding(.horizontal, 28)
            Spacer()
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
                .tint(HarnessPalette.textFaint)
            Text("Starting microphone…")
                .font(.subheadline)
                .foregroundStyle(HarnessPalette.textMuted)
        }
    }

    private var recordingContent: some View {
        VStack(spacing: 36) {
            // Elapsed leaf observes AudioRecorder.
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(HarnessPalette.recording)
                        .frame(width: 7, height: 7)
                        .accessibilityHidden(true)
                    Text("Recording")
                        .font(.subheadline)
                        .foregroundStyle(HarnessPalette.textMuted)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Recording")

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
                    HarnessIconButtonLabel(systemName: "xmark", size: 56, glyphSize: 17)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel recording")

                Button {
                    HapticFeedback.success()
                    Task { await stopAndTranscribe() }
                } label: {
                    HarnessIconButtonLabel(systemName: "checkmark", role: .primary, size: 96, glyphSize: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stop and transcribe")
                .disabled(!isMicLive)
                .opacity(isMicLive ? 1 : 0.45)
            }
            .padding(.horizontal, 28)
        }
    }

    private var processingContent: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
                .tint(HarnessPalette.textFaint)
            Text("Transcribing…")
                .font(.subheadline)
                .foregroundStyle(HarnessPalette.textMuted)
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
                isMicLive = false
                phase = recordingSession.hasRecordPermission ? .recording : .starting
                didAutoStart = false
                Task { await startRecording() }
            }
        }
    }

    private func startRecording() async {
        isStopping = false
        isMicLive = false
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
                isMicLive = false
                if isPresented {
                    isPresented = false
                }
                return
            }
            phase = .recording
            isMicLive = true
            // Distinct from the mic-open tap: confirms the session is actually live.
            HapticFeedback.medium()
        } catch is CancellationError {
            isMicLive = false
            // Cancelled mid-start; session manager already tore down. Avoid a stuck "Starting…" UI
            // if cancellation came from task teardown rather than the Cancel button.
            if isPresented {
                isPresented = false
            }
        } catch {
            isMicLive = false
            phase = .failed(error.localizedDescription)
        }
    }

    private func stopAndTranscribe() async {
        guard phase == .recording, !isStopping else {
            return
        }
        isStopping = true
        isMicLive = false
        recordingSession.beginStopBackgroundWork()
        defer { recordingSession.endStopBackgroundWork() }
        let generation = operationGeneration
        let peakLevel = recorder.peakLevelDuringSession
        let elapsedSeconds = TimeInterval(recorder.elapsedMs) / 1000.0

        do {
            let url = try await recorder.stop()
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
                // Deliver before dismissing: the isPresented setter clears `activeDictation`,
                // which the delivery callbacks still need.
                onConversationCreated(conversationId)
                isPresented = false
            case .sendToConversation(let conversationId):
                try DictationRecordingIndex.link(conversationId: conversationId, recordingURL: audioURL)
                onTranscriptSent(transcript)
                isPresented = false
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
        isMicLive = false
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
        let clamped = max(0, ms)
        let totalSeconds = clamped / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        let tenths = (clamped % 1000) / 100
        return String(format: "%d:%02d.%d", minutes, seconds, tenths)
    }
}

/// Observes capture drops from interruption / media-reset without rebuilding on elapsed ticks.
private struct DictationCaptureWatchdog: View {
    let recorder: AudioRecorder
    var onUnexpectedEnd: () -> Void
    @State private var isRecording = false

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
            .onAppear { isRecording = recorder.isRecording }
            .onReceive(recorder.$isRecording) { recording in
                let wasRecording = isRecording
                isRecording = recording
                guard wasRecording, !recording else { return }
                // Read intentionalStop from the recorder object at callback time —
                // a SwiftUI `let expectRecordingEnd` can still be stale here.
                guard !recorder.intentionalStop else { return }
                onUnexpectedEnd()
            }
    }
}

private struct DictationElapsedLabel: View {
    let recorder: AudioRecorder
    var font: Font = .system(size: 44, weight: .light)
    var color: Color = HarnessPalette.text
    var onMaxDuration: () -> Void
    @State private var elapsedMs = 0
    /// Elapsed keeps ticking past the limit; fire the stop exactly once.
    @State private var didFireMaxDuration = false

    var body: some View {
        Text(DictationElapsedFormatting.string(ms: elapsedMs))
            .font(font)
            .monospacedDigit()
            .foregroundStyle(color)
            .accessibilityLabel("Recording duration")
            .accessibilityValue(DictationElapsedFormatting.string(ms: elapsedMs))
            .onAppear { elapsedMs = recorder.elapsedMs }
            .onReceive(recorder.$elapsedMs) { ms in
                elapsedMs = ms
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
