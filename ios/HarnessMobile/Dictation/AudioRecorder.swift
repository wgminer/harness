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
    static let waveformSampleCount = 32
    /// Peak dB below this maps to silence (0). Runtime metering showed quiet-room noise
    /// around -50 dB; -65 made ambient noise read as ~0.23 "speech".
    static let silenceFloor: Float = -55
    /// Peak dB at/above this maps to full height (1).
    static let speechCeiling: Float = -14
    /// Perceptual curve — higher keeps quiet speech low and accents peaks.
    static let compressionExponent: Float = 1.25
    /// Fraction toward target when rising (fast attack).
    static let attack: Float = 0.85
    /// Fraction toward target when falling (slower release).
    static let release: Float = 0.28
    /// Brief hold so consonants register without strobing.
    static let peakHoldTicks = 2

    /// Maps peak power in dB to `0...1`. Silence is true `0`.
    static func normalizedLevel(fromDecibels power: Float) -> CGFloat {
        if power <= silenceFloor { return 0 }
        let clamped = min(max(power, silenceFloor), speechCeiling)
        let linear = (clamped - silenceFloor) / (speechCeiling - silenceFloor)
        let compressed = pow(linear, compressionExponent)
        return CGFloat(min(max(compressed, 0), 1))
    }

    /// Exponential smooth toward `target` with asymmetric attack/release.
    static func smooth(current: Float, toward target: Float) -> Float {
        let factor = target > current ? attack : release
        return current + (target - current) * factor
    }

    /// Appends `level` to a fixed-length sliding window.
    static func appendSample(_ level: CGFloat, to samples: [CGFloat], count: Int = waveformSampleCount) -> [CGFloat] {
        var next = samples
        if next.count >= count {
            next.removeFirst()
        }
        next.append(level)
        return next
    }
}

/// Validates a stopped recording before spending time on transcription.
enum RecordingCaptureValidation {
    /// Minimum duration before we treat the clip as potentially usable.
    static let minimumDurationSeconds: TimeInterval = 0.3
    /// Peak normalized level that counts as “heard something.”
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
    static let waveformSampleCount = AudioRecorderMetering.waveformSampleCount

    @Published private(set) var isRecording = false
    @Published private(set) var elapsedMs: Int = 0
    /// Single metering publish for the waveform leaf (~12 Hz). History lives in the view.
    @Published private(set) var audioLevel: CGFloat = 0
    /// Highest smoothed level seen while this take was recording (for pre-transcribe validation).
    @Published private(set) var peakLevelDuringSession: CGFloat = 0
    /// File left on disk after an unexpected teardown (interruption / media-reset / route fail).
    /// Cleared on the next intentional cancel or successful `start()`.
    private(set) var preservedRecordingURL: URL?
    /// Set before `stop()` / intentional `cancel()` so UI watchdogs can tell user/system
    /// teardown from interruption. Not @Published — read synchronously at onChange time.
    private(set) var intentionalStop = false

    private var recorder: AVAudioRecorder?
    private var outputURL: URL?
    private var timer: Timer?
    private var startedAt: Date?
    private var smoothedLevel: Float = 0
    private var heldPeak: Float = 0
    private var peakHoldRemaining = 0
    /// Counts metering ticks so we can publish to SwiftUI at a lower rate.
    private var publishTick = 0
    /// Bumped on every `cancel()` so an in-flight `start()` cannot leave the mic on after teardown.
    private var startGeneration = 0
    private var sessionObservers: [NSObjectProtocol] = []
    private var categoryPrepared = false

    /// Override in tests to avoid the system permission prompt / control timing.
    var permissionProvider: () async -> Bool = {
        await AudioRecorder.requestRecordPermissionIfNeeded()
    }

    /// True when mic access is already granted (no prompt needed on the start critical path).
    var hasRecordPermission: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    /// Warm the audio category without activating the mic (call from home/compose appear).
    func prepare() {
        do {
            try configureSessionCategory()
            categoryPrepared = true
        } catch {
            categoryPrepared = false
        }
    }

    func requestPermission() async -> Bool {
        await permissionProvider()
    }

    func start() async throws -> URL {
        if isRecording {
            cancel()
        }
        // Drop any leftover from a prior unexpected teardown before opening a new take.
        clearPreservedRecording(deleteFile: true)

        startGeneration += 1
        let generation = startGeneration

        let granted = await requestPermission()
        try ensureStartStillValid(generation)
        guard granted else { throw AudioRecorderError.permissionDenied }

        if !categoryPrepared {
            try configureSessionCategory()
            categoryPrepared = true
        }
        try ensureStartStillValid(generation)

        let session = AVAudioSession.sharedInstance()
        try session.setActive(true)
        try ensureStartStillValid(generation)

        let url = try RecordingStorage.newRecordingURL()
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        guard recorder.record() else { throw AudioRecorderError.failedToStart }

        if generation != startGeneration || Task.isCancelled {
            recorder.stop()
            try? FileManager.default.removeItem(at: url)
            deactivateSession()
            throw CancellationError()
        }

        self.recorder = recorder
        outputURL = url
        isRecording = true
        intentionalStop = false
        startedAt = Date()
        elapsedMs = 0
        resetWaveform()
        installSessionObservers()
        startTimer()
        return url
    }

    @discardableResult
    func stop() throws -> URL {
        guard let recorder, let url = outputURL else { throw AudioRecorderError.notRecording }
        // Mark before flipping isRecording so any observer sees an intentional end.
        intentionalStop = true
        stopTimer()
        removeSessionObservers()
        recorder.stop()
        isRecording = false
        self.recorder = nil
        outputURL = nil
        preservedRecordingURL = nil
        // Keep peakLevelDuringSession until the caller validates / resets.
        let level = audioLevel
        resetWaveformPublishing()
        // Preserve peak for validation after stop.
        peakLevelDuringSession = max(peakLevelDuringSession, level)
        deactivateSession()
        return url
    }

    /// Tears down capture. Pass `intentional: false` for interruption / media-reset /
    /// route failure so the sheet watchdog can show a failure instead of a stuck UI.
    /// Unexpected teardown **preserves** the file at `preservedRecordingURL` for retry/share.
    func cancel(intentional: Bool = true) {
        startGeneration += 1
        intentionalStop = intentional
        stopTimer()
        removeSessionObservers()
        recorder?.stop()

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
            resetWaveform()
        } else if let url {
            // Finalize on disk; leave peak/elapsed so the failure UI can still validate/retry.
            preservedRecordingURL = url
            let level = audioLevel
            resetWaveformPublishing()
            peakLevelDuringSession = max(peakLevelDuringSession, level)
        }

        deactivateSession()
    }

    /// Hand ownership of a preserved file to the UI (retry/share). Does not delete the file.
    @discardableResult
    func consumePreservedRecordingURL() -> URL? {
        let url = preservedRecordingURL
        preservedRecordingURL = nil
        return url
    }

    /// Test seam: seed a preserved URL as if unexpected teardown just ran.
    func testSeedPreservedRecordingURL(_ url: URL?) {
        preservedRecordingURL = url
    }

    private func clearPreservedRecording(deleteFile: Bool) {
        if deleteFile, let preservedRecordingURL {
            try? FileManager.default.removeItem(at: preservedRecordingURL)
        }
        preservedRecordingURL = nil
    }

    // MARK: - Permission

    private static func requestRecordPermissionIfNeeded() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .denied:
            return false
        case .undetermined:
            break
        @unknown default:
            break
        }

        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    // MARK: - Session

    private func configureSessionCategory() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .allowBluetooth]
        )
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func installSessionObservers() {
        removeSessionObservers()
        let center = NotificationCenter.default

        sessionObservers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(),
                queue: .main
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
                queue: .main
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
                queue: .main
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
            // Keep file; pause metering visually. AVAudioRecorder pauses itself on interruption.
            stopTimer()
        case .ended:
            let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if options.contains(.shouldResume), let recorder {
                // System may already have resumed capture — just restart metering.
                if recorder.isRecording {
                    startTimer()
                    return
                }
                do {
                    try AVAudioSession.sharedInstance().setActive(true)
                    if recorder.record() {
                        startTimer()
                        return
                    }
                } catch {
                    // Fall through to unexpected teardown (file preserved).
                }
            }
            // Cannot resume cleanly — preserve the file and fail the sheet clearly.
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
        // Media server died mid-take — file may be corrupt; unexpected cancel rather than silent zombie.
        categoryPrepared = false
        cancel(intentional: false)
    }

    private func handleRouteChange(_ notification: Notification) {
        guard isRecording else { return }
        guard let info = notification.userInfo,
              let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else { return }

        // Old device unavailable (e.g. Bluetooth disconnect) can leave a silent route.
        if reason == .oldDeviceUnavailable {
            // Try to keep recording on the built-in mic; if record isn't active, fail clearly.
            if let recorder, !recorder.isRecording {
                do {
                    try AVAudioSession.sharedInstance().setActive(true)
                    if !recorder.record() {
                        cancel(intentional: false)
                    } else {
                        startTimer()
                    }
                } catch {
                    cancel(intentional: false)
                }
            }
        }
    }

    // MARK: - Start validity / timer / metering

    private func ensureStartStillValid(_ generation: Int) throws {
        guard generation == startGeneration else { throw CancellationError() }
        try Task.checkCancellation()
    }

    private func startTimer() {
        stopTimer()
        // Tick metering often for smoothing, but publish to SwiftUI much less often.
        // Scheduled on RunLoop.main, so the callback is already on the main actor.
        let timer = Timer(timeInterval: 0.033, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let startedAt = self.startedAt else { return }
                let ms = Int(Date().timeIntervalSince(startedAt) * 1000)
                // Elapsed label only needs ~4 Hz; avoid rebuilding chrome every tick.
                if ms - self.elapsedMs >= 250 || ms < self.elapsedMs {
                    self.elapsedMs = ms
                }
                self.tickMetering()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
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

        // Short peak-hold so consonants register without strobing every tick.
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
        if level > peakLevelDuringSession {
            peakLevelDuringSession = level
        }

        publishTick += 1
        // Publish ~12 Hz — enough for the waveform; avoids SwiftUI rebuild storms.
        guard publishTick % 3 == 0 else { return }
        audioLevel = level
    }

    private func resetWaveform() {
        smoothedLevel = 0
        heldPeak = 0
        peakHoldRemaining = 0
        publishTick = 0
        audioLevel = 0
        peakLevelDuringSession = 0
    }

    private func resetWaveformPublishing() {
        smoothedLevel = 0
        heldPeak = 0
        peakHoldRemaining = 0
        publishTick = 0
        audioLevel = 0
    }
}
