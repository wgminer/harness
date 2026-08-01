import AVFoundation
import CoreGraphics
import Foundation

enum AudioRecorderError: LocalizedError, Equatable {
    case permissionDenied
    case failedToStart
    case notRecording
    case interrupted

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Microphone access is required for dictation. Enable it in Settings."
        case .failedToStart:
            return "Could not start recording."
        case .notRecording:
            return "No active recording."
        case .interrupted:
            return "Recording was interrupted. Try again."
        }
    }
}

/// Pure metering helpers — testable without a microphone.
enum AudioRecorderMetering {
    static let silenceFloor: Float = -55
    static let speechCeiling: Float = -14
    static let compressionExponent: Float = 1.25
    static let attack: Float = 0.85
    static let release: Float = 0.28
    static let peakHoldTicks = 2

    static func normalizedLevel(fromDecibels power: Float) -> CGFloat {
        if power <= silenceFloor { return 0 }
        let clamped = min(max(power, silenceFloor), speechCeiling)
        let linear = (clamped - silenceFloor) / (speechCeiling - silenceFloor)
        return CGFloat(min(max(pow(linear, compressionExponent), 0), 1))
    }

    static func smooth(current: Float, toward target: Float) -> Float {
        current + (target - current) * (target > current ? attack : release)
    }
}

/// Validates a stopped recording before spending time on transcription.
enum RecordingCaptureValidation {
    static let minimumDurationSeconds: TimeInterval = 0.3
    static let minimumPeakLevel: CGFloat = 0.04

    enum Failure: Equatable {
        case missingFile
        case tooShort
        case noSpeechDetected
    }

    static func validate(
        url: URL,
        peakLevelDuringSession: CGFloat,
        duration: TimeInterval? = nil
    ) -> Failure? {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        let fileSize = values?.fileSize ?? 0
        guard FileManager.default.fileExists(atPath: url.path), fileSize > 0 else {
            return .missingFile
        }

        let resolvedDuration = duration ?? RecordingStorage.duration(for: url) ?? 0
        if resolvedDuration < minimumDurationSeconds {
            return .tooShort
        }
        if peakLevelDuringSession < minimumPeakLevel {
            return .noSpeechDetected
        }
        return nil
    }

    static func userMessage(for failure: Failure) -> String {
        switch failure {
        case .missingFile:
            return "The recording file could not be saved."
        case .tooShort:
            return "Recording was too short. Hold a bit longer, then stop."
        case .noSpeechDetected:
            return "No speech was detected. Try recording again closer to the mic."
        }
    }
}

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    /// All AVAudioSession / AVAudioRecorder mutations run here — never freestyle Task.detached.
    private static let sessionQueue = DispatchQueue(label: "com.harness.mobile.audio-session")

    @Published private(set) var isRecording = false
    @Published private(set) var elapsedMs: Int = 0
    /// Not `@Published` — peak tracking for post-stop validation only.
    private(set) var peakLevelDuringSession: CGFloat = 0
    private(set) var currentMeterLevel: CGFloat = 0
    /// File preserved after unexpected teardown for retry/share.
    private(set) var preservedRecordingURL: URL?
    /// True for user stop/cancel so the sheet watchdog ignores the drop.
    private(set) var intentionalStop = false

    private var recorder: AVAudioRecorder?
    private var outputURL: URL?
    private var timer: Timer?
    private var startedAt: Date?
    private var smoothedLevel: Float = 0
    private var heldPeak: Float = 0
    private var peakHoldRemaining = 0
    private var startGeneration = 0
    private var sessionObservers: [NSObjectProtocol] = []
    private var categoryPrepared = false

    var permissionProvider: () async -> Bool = {
        await AudioRecorder.requestRecordPermissionIfNeeded()
    }

    var hasRecordPermission: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    func prepare() {
        Self.sessionQueue.async { [weak self] in
            do {
                try Self.configureSessionCategory()
                Task { @MainActor in
                    self?.categoryPrepared = true
                }
            } catch {
                Task { @MainActor in
                    self?.categoryPrepared = false
                }
            }
        }
    }

    func requestPermission() async -> Bool {
        await permissionProvider()
    }

    func start() async throws -> URL {
        if isRecording {
            cancel()
        }
        clearPreservedRecording(deleteFile: true)

        startGeneration += 1
        let generation = startGeneration

        let granted = await requestPermission()
        try ensureStartStillValid(generation)
        guard granted else { throw AudioRecorderError.permissionDenied }

        let needsCategory = !categoryPrepared
        let capture: CaptureStartResult = try await withCheckedThrowingContinuation { continuation in
            Self.sessionQueue.async {
                do {
                    if needsCategory {
                        try Self.configureSessionCategory()
                    }
                    let result = try Self.activateAndBeginCapture()
                    continuation.resume(returning: result)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        if needsCategory {
            categoryPrepared = true
        }

        if generation != startGeneration || Task.isCancelled {
            Self.sessionQueue.async {
                Self.discardCapture(capture)
                Self.deactivateSession()
            }
            throw CancellationError()
        }

        capture.recorder.delegate = self
        self.recorder = capture.recorder
        outputURL = capture.url
        isRecording = true
        intentionalStop = false
        startedAt = Date()
        elapsedMs = 0
        resetMetering()
        installSessionObservers()
        startTimer()
        return capture.url
    }

    @discardableResult
    func stop() throws -> URL {
        guard let recorder, let url = outputURL else { throw AudioRecorderError.notRecording }
        intentionalStop = true
        if let startedAt {
            elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        }
        stopTimer()
        removeSessionObservers()
        self.recorder = nil
        outputURL = nil
        isRecording = false
        preservedRecordingURL = nil
        let level = currentMeterLevel
        resetMeteringLevels()
        peakLevelDuringSession = max(peakLevelDuringSession, level)

        Self.sessionQueue.sync {
            recorder.stop()
            Self.deactivateSession()
        }
        return url
    }

    /// Unexpected teardown preserves the file for retry/share.
    func cancel(intentional: Bool = true) {
        startGeneration += 1
        intentionalStop = intentional
        stopTimer()
        removeSessionObservers()

        let activeRecorder = recorder
        let url = outputURL
        recorder = nil
        outputURL = nil
        isRecording = false

        if intentional {
            if let url {
                try? FileManager.default.removeItem(at: url)
            }
            clearPreservedRecording(deleteFile: true)
            elapsedMs = 0
            startedAt = nil
            resetMetering()
        } else if let url {
            preservedRecordingURL = url
            let level = currentMeterLevel
            resetMeteringLevels()
            peakLevelDuringSession = max(peakLevelDuringSession, level)
        }

        Self.sessionQueue.async {
            activeRecorder?.stop()
            Self.deactivateSession()
        }
    }

    @discardableResult
    func consumePreservedRecordingURL() -> URL? {
        let url = preservedRecordingURL
        preservedRecordingURL = nil
        return url
    }

    func testSeedPreservedRecordingURL(_ url: URL?) {
        preservedRecordingURL = url
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            guard self.recorder === recorder, self.isRecording else { return }
            cancel(intentional: false)
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            guard self.recorder === recorder, self.isRecording, !flag else { return }
            cancel(intentional: false)
        }
    }

    private func clearPreservedRecording(deleteFile: Bool) {
        if deleteFile, let preservedRecordingURL {
            try? FileManager.default.removeItem(at: preservedRecordingURL)
        }
        preservedRecordingURL = nil
    }

    private static func requestRecordPermissionIfNeeded() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .denied:
            return false
        default:
            break
        }

        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    nonisolated private static func configureSessionCategory() throws {
        try AVAudioSession.sharedInstance().setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .allowBluetooth]
        )
    }

    nonisolated private static func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func installSessionObservers() {
        removeSessionObservers()
        let center = NotificationCenter.default

        sessionObservers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(),
                queue: nil
            ) { [weak self] notification in
                Task { @MainActor in
                    self?.handleInterruption(notification)
                }
            }
        )

        sessionObservers.append(
            center.addObserver(
                forName: AVAudioSession.mediaServicesWereResetNotification,
                object: AVAudioSession.sharedInstance(),
                queue: nil
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.handleMediaServicesReset()
                }
            }
        )

        sessionObservers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: AVAudioSession.sharedInstance(),
                queue: nil
            ) { [weak self] notification in
                Task { @MainActor in
                    self?.handleRouteChange(notification)
                }
            }
        )
    }

    private func removeSessionObservers() {
        for observer in sessionObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        sessionObservers.removeAll()
    }

    private func handleInterruption(_ notification: Notification) {
        guard isRecording else { return }
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        switch type {
        case .began:
            stopTimer()
        case .ended:
            let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if options.contains(.shouldResume), let recorder {
                if recorder.isRecording {
                    startTimer()
                    return
                }
                let resumed = Self.sessionQueue.sync { () -> Bool in
                    do {
                        try AVAudioSession.sharedInstance().setActive(true)
                        return recorder.record()
                    } catch {
                        return false
                    }
                }
                if resumed {
                    startTimer()
                    return
                }
            }
            cancel(intentional: false)
        @unknown default:
            break
        }
    }

    private func handleMediaServicesReset() {
        guard isRecording else {
            categoryPrepared = false
            return
        }
        categoryPrepared = false
        cancel(intentional: false)
    }

    private func handleRouteChange(_ notification: Notification) {
        guard isRecording else { return }
        guard let info = notification.userInfo,
              let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else { return }

        if reason == .oldDeviceUnavailable {
            if let recorder, !recorder.isRecording {
                let resumed = Self.sessionQueue.sync { () -> Bool in
                    do {
                        try AVAudioSession.sharedInstance().setActive(true)
                        return recorder.record()
                    } catch {
                        return false
                    }
                }
                if resumed {
                    startTimer()
                } else {
                    cancel(intentional: false)
                }
            }
        }
    }

    // MARK: - Timer / metering

    private func ensureStartStillValid(_ generation: Int) throws {
        guard generation == startGeneration else { throw CancellationError() }
        try Task.checkCancellation()
    }

    private struct CaptureStartResult: @unchecked Sendable {
        let recorder: AVAudioRecorder
        let url: URL
    }

    nonisolated private static func activateAndBeginCapture() throws -> CaptureStartResult {
        let session = AVAudioSession.sharedInstance()
        try session.setActive(true)

        let url = try RecordingStorage.newRecordingURL()
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        guard recorder.record() else {
            try? FileManager.default.removeItem(at: url)
            deactivateSession()
            throw AudioRecorderError.failedToStart
        }
        return CaptureStartResult(recorder: recorder, url: url)
    }

    nonisolated private static func discardCapture(_ capture: CaptureStartResult) {
        capture.recorder.stop()
        try? FileManager.default.removeItem(at: capture.url)
    }

    private func startTimer() {
        stopTimer()
        // ~10ms so the recording sheet can show live milliseconds.
        let timer = Timer(timeInterval: 0.01, repeats: true) { [weak self] _ in
            guard let self else { return }
            DispatchQueue.main.async { self.timerFired() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func timerFired() {
        guard let startedAt else { return }
        let ms = Int(Date().timeIntervalSince(startedAt) * 1000)
        if ms != elapsedMs {
            elapsedMs = ms
        }
        tickMetering()
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tickMetering() {
        guard let recorder, isRecording else { return }
        recorder.updateMeters()
        let peak = recorder.peakPower(forChannel: 0)
        let average = recorder.averagePower(forChannel: 0)
        let target = Float(
            AudioRecorderMetering.normalizedLevel(fromDecibels: max(peak, average))
        )

        if target >= heldPeak {
            heldPeak = target
            peakHoldRemaining = AudioRecorderMetering.peakHoldTicks
        } else if peakHoldRemaining > 0 {
            peakHoldRemaining -= 1
        } else {
            heldPeak = target
        }

        smoothedLevel = AudioRecorderMetering.smooth(current: smoothedLevel, toward: heldPeak)
        let level = CGFloat(smoothedLevel)
        currentMeterLevel = level
        if level > peakLevelDuringSession {
            peakLevelDuringSession = level
        }
    }

    private func resetMetering() {
        resetMeteringLevels()
        peakLevelDuringSession = 0
    }

    private func resetMeteringLevels() {
        smoothedLevel = 0
        heldPeak = 0
        peakHoldRemaining = 0
        currentMeterLevel = 0
    }
}
