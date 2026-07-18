import AVFoundation
import CoreGraphics
import Foundation

enum AudioRecorderError: LocalizedError, Equatable {
    case permissionDenied
    case failedToStart
    case notRecording

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Microphone access is required for dictation. Enable it in Settings."
        case .failedToStart:
            return "Could not start recording."
        case .notRecording:
            return "No active recording."
        }
    }
}

/// Pure metering helpers — testable without a microphone.
enum AudioRecorderMetering {
    static let waveformSampleCount = 32
    /// Peak dB below this maps to silence (0).
    static let silenceFloor: Float = -55
    /// Peak dB at/above this maps to full height (1).
    static let speechCeiling: Float = -14
    /// Perceptual curve — higher keeps quiet speech low and accents peaks.
    static let compressionExponent: Float = 1.75
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

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let waveformSampleCount = AudioRecorderMetering.waveformSampleCount

    @Published private(set) var isRecording = false
    @Published private(set) var elapsedMs: Int = 0
    @Published private(set) var audioLevel: CGFloat = 0
    @Published private(set) var waveformSamples: [CGFloat] = Array(
        repeating: 0,
        count: AudioRecorder.waveformSampleCount
    )

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

    /// Override in tests to avoid the system permission prompt / control timing.
    var permissionProvider: () async -> Bool = {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
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

        startGeneration += 1
        let generation = startGeneration

        let granted = await requestPermission()
        try ensureStartStillValid(generation)
        guard granted else { throw AudioRecorderError.permissionDenied }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .allowBluetooth]
        )
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
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            throw CancellationError()
        }

        self.recorder = recorder
        outputURL = url
        isRecording = true
        startedAt = Date()
        elapsedMs = 0
        resetWaveform()
        startTimer()
        return url
    }

    @discardableResult
    func stop() throws -> URL {
        guard let recorder, let url = outputURL else { throw AudioRecorderError.notRecording }
        stopTimer()
        recorder.stop()
        isRecording = false
        self.recorder = nil
        outputURL = nil
        resetWaveform()
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return url
    }

    func cancel() {
        startGeneration += 1
        stopTimer()
        recorder?.stop()
        if let url = outputURL {
            try? FileManager.default.removeItem(at: url)
        }
        recorder = nil
        outputURL = nil
        isRecording = false
        elapsedMs = 0
        startedAt = nil
        resetWaveform()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func ensureStartStillValid(_ generation: Int) throws {
        guard generation == startGeneration else { throw CancellationError() }
        try Task.checkCancellation()
    }

    private func startTimer() {
        stopTimer()
        // Tick metering often for smoothing, but publish to SwiftUI much less often.
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
        let target = Float(AudioRecorderMetering.normalizedLevel(fromDecibels: peak))

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

        publishTick += 1
        // Publish ~12 Hz — enough for the waveform; avoids SwiftUI rebuild storms.
        guard publishTick % 3 == 0 else { return }
        audioLevel = level
        waveformSamples = AudioRecorderMetering.appendSample(level, to: waveformSamples)
    }

    private func resetWaveform() {
        smoothedLevel = 0
        heldPeak = 0
        peakHoldRemaining = 0
        publishTick = 0
        audioLevel = 0
        waveformSamples = Array(repeating: 0, count: Self.waveformSampleCount)
    }
}
