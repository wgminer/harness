import AVFoundation
import Foundation

enum AudioRecorderError: LocalizedError {
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

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let waveformSampleCount = 40

    @Published private(set) var isRecording = false
    @Published private(set) var elapsedMs: Int = 0
    @Published private(set) var audioLevel: CGFloat = 0
    @Published private(set) var waveformSamples: [CGFloat] = Array(
        repeating: 0.06,
        count: AudioRecorder.waveformSampleCount
    )

    private var recorder: AVAudioRecorder?
    private var outputURL: URL?
    private var timer: Timer?
    private var startedAt: Date?
    private var smoothedLevel: Float = 0.06

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start() async throws -> URL {
        let granted = await requestPermission()
        guard granted else { throw AudioRecorderError.permissionDenied }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

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
        resetWaveform()
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return url
    }

    func cancel() {
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

    var hasExceededMaxDuration: Bool {
        elapsedMs >= Int(RecordingStorage.maxRecordingDuration * 1000)
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 0.033, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let startedAt = self.startedAt else { return }
                self.elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
                self.tickMetering()
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tickMetering() {
        guard let recorder, isRecording else { return }
        recorder.updateMeters()
        let average = recorder.averagePower(forChannel: 0)
        let target = Float(Self.normalizedLevel(fromDecibels: average))
        let smoothing: Float = target > smoothedLevel ? 0.35 : 0.12
        smoothedLevel += (target - smoothedLevel) * smoothing
        let level = CGFloat(smoothedLevel)
        audioLevel = level

        var next = waveformSamples
        if !next.isEmpty {
            next.removeFirst()
        }
        next.append(level)
        waveformSamples = next
    }

    private func resetWaveform() {
        smoothedLevel = 0.06
        audioLevel = 0
        waveformSamples = Array(repeating: 0.06, count: Self.waveformSampleCount)
    }

    private static func normalizedLevel(fromDecibels power: Float) -> CGFloat {
        let silenceFloor: Float = -52
        let speechCeiling: Float = -10
        if power <= silenceFloor { return 0.06 }
        let clamped = min(max(power, silenceFloor), speechCeiling)
        let linear = (clamped - silenceFloor) / (speechCeiling - silenceFloor)
        let compressed = pow(linear, 0.62)
        return CGFloat(0.06 + compressed * 0.88)
    }
}
