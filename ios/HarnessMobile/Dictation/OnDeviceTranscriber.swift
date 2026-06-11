import AVFoundation
import Foundation
import Speech

enum OnDeviceTranscriberError: LocalizedError {
    case permissionDenied
    case recognizerUnavailable
    case emptyTranscript
    case audioNotReady
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Speech recognition access is required. Enable it in Settings."
        case .recognizerUnavailable:
            return "On-device speech recognition is not available for this language."
        case .emptyTranscript:
            return "No speech was detected in the recording."
        case .audioNotReady:
            return "The recording file is not ready yet. Try again in a moment."
        case .failed(let message):
            return message
        }
    }
}

/// On-device transcription via Apple's Speech framework.
///
/// iOS 26+ uses `SpeechAnalyzer` / `SpeechTranscriber` for full-length recordings.
/// Earlier releases chunk audio to stay within `SFSpeechRecognizer`'s ~one-minute limit.
enum OnDeviceTranscriber {
    private static let legacyChunkDuration: TimeInterval = 50
    private static let legacyChunkThreshold: TimeInterval = 55
    private static let audioReadyTimeout: TimeInterval = 2
    private static let audioReadyPollNanos: UInt64 = 50_000_000

    static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    static func ensureAudioFileReady(at url: URL) async throws {
        let deadline = Date().addingTimeInterval(audioReadyTimeout)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: url.path),
               let duration = RecordingStorage.duration(for: url),
               duration > 0 {
                return
            }
            try await Task.sleep(nanoseconds: audioReadyPollNanos)
        }
        throw OnDeviceTranscriberError.audioNotReady
    }

    static func transcribe(at url: URL, locale: Locale = .current) async throws -> String {
        let auth = await requestAuthorization()
        guard auth == .authorized else { throw OnDeviceTranscriberError.permissionDenied }

        try await ensureAudioFileReady(at: url)

        if #available(iOS 26.0, *) {
            do {
                return try await transcribeWithSpeechAnalyzer(at: url, locale: locale)
            } catch {
                // Fall back to the legacy recognizer when the new API is unavailable.
            }
        }

        return try await transcribeWithLegacyRecognizer(at: url, locale: locale)
    }

    @available(iOS 26.0, *)
    private static func transcribeWithSpeechAnalyzer(at url: URL, locale: Locale) async throws -> String {
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        async let transcriptionFuture: String = try transcriber.results.reduce(into: "") { text, result in
            text += String(result.text.characters)
        }

        let audioFile = try AVAudioFile(forReading: url)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
            try await analyzer.finalizeAndFinish(through: lastSample)
        } else {
            await analyzer.cancelAndFinishNow()
        }

        let text = try await transcriptionFuture
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            throw OnDeviceTranscriberError.emptyTranscript
        }
        return text
    }

    private static func transcribeWithLegacyRecognizer(at url: URL, locale: Locale) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            throw OnDeviceTranscriberError.recognizerUnavailable
        }

        let duration = RecordingStorage.duration(for: url) ?? 0
        if duration <= legacyChunkThreshold {
            return try await transcribeLegacySegment(at: url, recognizer: recognizer, allowEmpty: false)
        }

        var transcripts: [String] = []
        var offset: TimeInterval = 0
        while offset < duration {
            let segmentDuration = min(legacyChunkDuration, duration - offset)
            let segmentURL = try await exportSegment(from: url, start: offset, duration: segmentDuration)
            defer { try? FileManager.default.removeItem(at: segmentURL) }

            let segmentText = try await transcribeLegacySegment(at: segmentURL, recognizer: recognizer, allowEmpty: true)
            if !segmentText.isEmpty {
                transcripts.append(segmentText)
            }
            offset += segmentDuration
        }

        let combined = transcripts.joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if combined.isEmpty {
            throw OnDeviceTranscriberError.emptyTranscript
        }
        return combined
    }

    private static func transcribeLegacySegment(
        at url: URL,
        recognizer: SFSpeechRecognizer,
        allowEmpty: Bool
    ) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let request = SFSpeechURLRecognitionRequest(url: url)
            request.shouldReportPartialResults = true
            request.taskHint = .dictation
            if recognizer.supportsOnDeviceRecognition {
                request.requiresOnDeviceRecognition = true
            }

            var latestText = ""
            recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    continuation.resume(throwing: OnDeviceTranscriberError.failed(error.localizedDescription))
                    return
                }
                guard let result else { return }

                latestText = result.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if result.isFinal {
                    if latestText.isEmpty, !allowEmpty {
                        continuation.resume(throwing: OnDeviceTranscriberError.emptyTranscript)
                    } else {
                        continuation.resume(returning: latestText)
                    }
                }
            }
        }
    }

    private static func exportSegment(
        from sourceURL: URL,
        start: TimeInterval,
        duration: TimeInterval
    ) async throws -> URL {
        let asset = AVURLAsset(url: sourceURL)
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("harness_seg_\(UUID().uuidString).m4a")

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw OnDeviceTranscriberError.failed("Could not prepare audio segment for transcription.")
        }

        exportSession.outputURL = destination
        exportSession.outputFileType = .m4a
        let startTime = CMTime(seconds: start, preferredTimescale: 600)
        let endTime = CMTime(seconds: start + duration, preferredTimescale: 600)
        exportSession.timeRange = CMTimeRangeFromTimeToTime(start: startTime, end: endTime)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            exportSession.exportAsynchronously {
                switch exportSession.status {
                case .completed:
                    continuation.resume()
                case .cancelled:
                    continuation.resume(throwing: OnDeviceTranscriberError.failed("Audio export cancelled."))
                case .failed:
                    let message = exportSession.error?.localizedDescription ?? "Audio export failed."
                    continuation.resume(throwing: OnDeviceTranscriberError.failed(message))
                default:
                    continuation.resume(throwing: OnDeviceTranscriberError.failed("Audio export did not complete."))
                }
            }
        }

        return destination
    }
}
