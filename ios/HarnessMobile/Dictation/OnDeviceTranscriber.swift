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
    /// SFSpeechURLRecognitionRequest silently truncates long clips (often to the
    /// last utterance) when run as one shot — keep chunks short.
    private static let legacyChunkDuration: TimeInterval = 15
    private static let legacyChunkThreshold: TimeInterval = 20
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
            // Skip SpeechAnalyzer when the locale model isn't installed — asset install
            // fails with "not subscribed" and only wastes time before legacy.
            let localeInstalled = await SpeechTranscriber.installedLocales
                .contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
            if localeInstalled {
                do {
                    return try await transcribeWithSpeechAnalyzer(at: url, locale: locale)
                } catch {
                    // Fall through to legacy SFSpeechRecognizer.
                }
            }
        }

        return try await transcribeWithLegacyRecognizer(at: url, locale: locale)
    }

    @available(iOS 26.0, *)
    private static func transcribeWithSpeechAnalyzer(at url: URL, locale: Locale) async throws -> String {
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)

        // Caller already verified the locale is installed — do not attempt asset install
        // here (AssetInventory throws "not subscribed" and only delays legacy fallback).

        // SpeechAnalyzer does not accept AAC directly ("Audio format is not supported") —
        // convert the recording to the analyzer's preferred PCM format and stream it in.
        guard let analysisFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw OnDeviceTranscriberError.recognizerUnavailable
        }

        async let transcriptionFuture: String = try transcriber.results.reduce(into: "") { text, result in
            text += String(result.text.characters)
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (inputSequence, inputBuilder) = AsyncStream<AnalyzerInput>.makeStream()
        try await analyzer.start(inputSequence: inputSequence)

        do {
            let audioFile = try AVAudioFile(forReading: url)
            try feedConvertedAudio(from: audioFile, to: analysisFormat, into: inputBuilder)
            inputBuilder.finish()
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        } catch {
            inputBuilder.finish()
            await analyzer.cancelAndFinishNow()
            throw error
        }

        let text = try await transcriptionFuture
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            throw OnDeviceTranscriberError.emptyTranscript
        }
        return text
    }

    /// Decode the file (AVAudioFile yields PCM for AAC sources) and convert chunks into
    /// the analyzer's required format.
    @available(iOS 26.0, *)
    private static func feedConvertedAudio(
        from file: AVAudioFile,
        to format: AVAudioFormat,
        into builder: AsyncStream<AnalyzerInput>.Continuation
    ) throws {
        let sourceFormat = file.processingFormat
        let chunkFrames: AVAudioFrameCount = 8192

        if sourceFormat == format {
            while true {
                guard let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: chunkFrames) else { break }
                try file.read(into: buffer)
                guard buffer.frameLength > 0 else { break }
                builder.yield(AnalyzerInput(buffer: buffer))
            }
            return
        }

        guard let converter = AVAudioConverter(from: sourceFormat, to: format) else {
            throw OnDeviceTranscriberError.failed("Could not convert audio for transcription.")
        }

        let ratio = format.sampleRate / sourceFormat.sampleRate
        let outCapacity = AVAudioFrameCount((Double(chunkFrames) * ratio).rounded(.up)) + 1024
        var sourceExhausted = false

        while true {
            guard let outBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outCapacity) else { break }
            var conversionError: NSError?
            let status = converter.convert(to: outBuffer, error: &conversionError) { packetCount, inputStatus in
                if sourceExhausted {
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                let capacity = min(AVAudioFrameCount(packetCount), chunkFrames)
                guard let inBuffer = AVAudioPCMBuffer(
                    pcmFormat: sourceFormat,
                    frameCapacity: capacity
                ) else {
                    sourceExhausted = true
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                do {
                    try file.read(into: inBuffer)
                } catch {
                    sourceExhausted = true
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                guard inBuffer.frameLength > 0 else {
                    sourceExhausted = true
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                inputStatus.pointee = .haveData
                return inBuffer
            }

            if let conversionError {
                throw OnDeviceTranscriberError.failed(conversionError.localizedDescription)
            }
            if outBuffer.frameLength > 0 {
                builder.yield(AnalyzerInput(buffer: outBuffer))
            }
            if status == .endOfStream || status == .error {
                break
            }
        }
    }

    private static func transcribeWithLegacyRecognizer(at url: URL, locale: Locale) async throws -> String {
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            throw OnDeviceTranscriberError.recognizerUnavailable
        }

        let duration = RecordingStorage.duration(for: url) ?? 0
        if duration <= legacyChunkThreshold {
            return try await transcribeLegacySegmentWithFallback(
                at: url,
                recognizer: recognizer,
                duration: duration,
                allowEmpty: false
            )
        }

        var transcripts: [String] = []
        var offset: TimeInterval = 0
        while offset < duration {
            let segmentDuration = min(legacyChunkDuration, duration - offset)
            let segmentURL = try await exportSegment(from: url, start: offset, duration: segmentDuration)
            defer { try? FileManager.default.removeItem(at: segmentURL) }

            let segmentText = try await transcribeLegacySegmentWithFallback(
                at: segmentURL,
                recognizer: recognizer,
                duration: segmentDuration,
                allowEmpty: true
            )
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

    /// On-device recognition sometimes returns a near-empty final for long clips.
    /// Retry once on-device only — never escalate to Apple servers.
    private static func transcribeLegacySegmentWithFallback(
        at url: URL,
        recognizer: SFSpeechRecognizer,
        duration: TimeInterval,
        allowEmpty: Bool
    ) async throws -> String {
        let requireOnDevice = recognizer.supportsOnDeviceRecognition
        let first = try await transcribeLegacySegment(
            at: url,
            recognizer: recognizer,
            allowEmpty: true,
            requireOnDevice: requireOnDevice
        )
        if !looksTruncated(first, duration: duration) {
            if first.isEmpty, !allowEmpty {
                throw OnDeviceTranscriberError.emptyTranscript
            }
            return first
        }

        let second = try await transcribeLegacySegment(
            at: url,
            recognizer: recognizer,
            allowEmpty: allowEmpty,
            requireOnDevice: requireOnDevice
        )
        if second.isEmpty, !allowEmpty {
            throw OnDeviceTranscriberError.emptyTranscript
        }
        // Prefer the denser of the two when both look sparse.
        let firstCount = first.trimmingCharacters(in: .whitespacesAndNewlines).count
        let secondCount = second.trimmingCharacters(in: .whitespacesAndNewlines).count
        if looksTruncated(second, duration: duration), secondCount < firstCount {
            return first
        }
        return second
    }

    /// Near-empty finals relative to clip length — typical silent truncation to a last fragment.
    /// Pause-heavy but non-empty speech should not trip this (avoids needless retries).
    static func looksTruncated(_ text: String, duration: TimeInterval) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return true }
        guard duration >= 8 else { return false }
        return trimmed.count < max(12, Int(duration * 0.5))
    }

    private static func transcribeLegacySegment(
        at url: URL,
        recognizer: SFSpeechRecognizer,
        allowEmpty: Bool,
        requireOnDevice: Bool = true
    ) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let request = SFSpeechURLRecognitionRequest(url: url)
            // File-based recognition: one final result is more reliable than progressive
            // partials, which can leave only the last utterance on long clips.
            request.shouldReportPartialResults = false
            request.taskHint = .dictation
            if requireOnDevice, recognizer.supportsOnDeviceRecognition {
                request.requiresOnDeviceRecognition = true
            }

            var latestText = ""
            var didFinish = false
            recognizer.recognitionTask(with: request) { result, error in
                guard !didFinish else { return }
                if let error {
                    didFinish = true
                    continuation.resume(throwing: OnDeviceTranscriberError.failed(error.localizedDescription))
                    return
                }
                guard let result else { return }

                latestText = result.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if result.isFinal {
                    didFinish = true
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
