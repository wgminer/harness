import AVFoundation
import Foundation
import Speech

enum ExitCode: Int32 {
  case success = 0
  case general = 1
  case permissionDenied = 2
  case recognizerUnavailable = 3
  case emptyTranscript = 4
  case audioNotReady = 5
}

enum TranscriptionError: LocalizedError {
  case permissionDenied
  case recognizerUnavailable
  case emptyTranscript
  case audioNotReady
  case failed(String)

  var exitCode: ExitCode {
    switch self {
    case .permissionDenied: return .permissionDenied
    case .recognizerUnavailable: return .recognizerUnavailable
    case .emptyTranscript: return .emptyTranscript
    case .audioNotReady: return .audioNotReady
    case .failed: return .general
    }
  }

  var errorDescription: String? {
    switch self {
    case .permissionDenied:
      return "Speech recognition access is required. Enable it in System Settings → Privacy & Security → Speech Recognition."
    case .recognizerUnavailable:
      return "On-device speech recognition is not available for this language. Install the dictation language in System Settings → Keyboard → Dictation."
    case .emptyTranscript:
      return "No speech was detected in the recording."
    case .audioNotReady:
      return "The recording file is not ready yet. Try again in a moment."
    case .failed(let message):
      return message
    }
  }
}

struct CLIArgs {
  let audioURL: URL
  let locale: Locale
}

func parseArgs() throws -> CLIArgs {
  let args = CommandLine.arguments.dropFirst()
  var positional: [String] = []
  var locale = Locale.current

  var iterator = args.makeIterator()
  while let arg = iterator.next() {
    if arg == "--locale" {
      guard let value = iterator.next(), !value.isEmpty else {
        throw TranscriptionError.failed("Missing value for --locale.")
      }
      locale = Locale(identifier: value)
      continue
    }
    if arg.hasPrefix("-") {
      throw TranscriptionError.failed("Unknown option: \(arg)")
    }
    positional.append(arg)
  }

  guard let path = positional.first else {
    throw TranscriptionError.failed("Usage: HarnessSpeech <wav-path> [--locale <id>]")
  }
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.fileExists(atPath: url.path) else {
    throw TranscriptionError.failed("Audio file not found: \(path)")
  }
  return CLIArgs(audioURL: url, locale: locale)
}

func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
  await withCheckedContinuation { continuation in
    SFSpeechRecognizer.requestAuthorization { status in
      continuation.resume(returning: status)
    }
  }
}

func audioDuration(for url: URL) -> TimeInterval? {
  let asset = AVURLAsset(url: url)
  let seconds = CMTimeGetSeconds(asset.duration)
  guard seconds.isFinite, seconds > 0 else { return nil }
  return seconds
}

func ensureAudioFileReady(at url: URL) async throws {
  let timeout: TimeInterval = 2
  let pollNanos: UInt64 = 50_000_000
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if FileManager.default.fileExists(atPath: url.path),
       let duration = audioDuration(for: url),
       duration > 0 {
      return
    }
    try await Task.sleep(nanoseconds: pollNanos)
  }
  throw TranscriptionError.audioNotReady
}

@available(macOS 26.0, *)
func ensureSpeechAssets(for transcriber: SpeechTranscriber) async throws {
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    try await request.downloadAndInstall()
  }
}

@available(macOS 26.0, *)
func transcribeWithSpeechAnalyzer(at url: URL, locale: Locale) async throws -> String {
  let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
  try await ensureSpeechAssets(for: transcriber)

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
    throw TranscriptionError.emptyTranscript
  }
  return text
}

private let legacyChunkDuration: TimeInterval = 50
private let legacyChunkThreshold: TimeInterval = 55

func transcribeLegacySegment(
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
        continuation.resume(throwing: TranscriptionError.failed(error.localizedDescription))
        return
      }
      guard let result else { return }

      latestText = result.bestTranscription.formattedString
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if result.isFinal {
        if latestText.isEmpty, !allowEmpty {
          continuation.resume(throwing: TranscriptionError.emptyTranscript)
        } else {
          continuation.resume(returning: latestText)
        }
      }
    }
  }
}

func exportSegment(from sourceURL: URL, start: TimeInterval, duration: TimeInterval) async throws -> URL {
  let asset = AVURLAsset(url: sourceURL)
  let destination = FileManager.default.temporaryDirectory
    .appendingPathComponent("harness_seg_\(UUID().uuidString).m4a")

  guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
    throw TranscriptionError.failed("Could not prepare audio segment for transcription.")
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
        continuation.resume(throwing: TranscriptionError.failed("Audio export cancelled."))
      case .failed:
        let message = exportSession.error?.localizedDescription ?? "Audio export failed."
        continuation.resume(throwing: TranscriptionError.failed(message))
      default:
        continuation.resume(throwing: TranscriptionError.failed("Audio export did not complete."))
      }
    }
  }

  return destination
}

func transcribeWithLegacyRecognizer(at url: URL, locale: Locale) async throws -> String {
  guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
    throw TranscriptionError.recognizerUnavailable
  }

  let duration = audioDuration(for: url) ?? 0
  if duration <= legacyChunkThreshold {
    return try await transcribeLegacySegment(at: url, recognizer: recognizer, allowEmpty: false)
  }

  var transcripts: [String] = []
  var offset: TimeInterval = 0
  while offset < duration {
    let segmentDuration = min(legacyChunkDuration, duration - offset)
    let segmentURL = try await exportSegment(from: url, start: offset, duration: segmentDuration)
    defer { try? FileManager.default.removeItem(at: segmentURL) }

    let segmentText = try await transcribeLegacySegment(
      at: segmentURL,
      recognizer: recognizer,
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
    throw TranscriptionError.emptyTranscript
  }
  return combined
}

func transcribe(at url: URL, locale: Locale) async throws -> String {
  let auth = await requestAuthorization()
  guard auth == .authorized else { throw TranscriptionError.permissionDenied }

  try await ensureAudioFileReady(at: url)

  if #available(macOS 26.0, *) {
    do {
      return try await transcribeWithSpeechAnalyzer(at: url, locale: locale)
    } catch {
      // Fall back to the legacy recognizer when the new API is unavailable.
    }
  }

  return try await transcribeWithLegacyRecognizer(at: url, locale: locale)
}

func fail(_ error: Error) -> Never {
  let message: String
  let code: ExitCode
  if let transcriptionError = error as? TranscriptionError {
    message = transcriptionError.errorDescription ?? "Transcription failed."
    code = transcriptionError.exitCode
  } else {
    message = error.localizedDescription
    code = .general
  }
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(code.rawValue)
}

@main
struct HarnessSpeech {
  static func main() async {
    do {
      let args = try parseArgs()
      let text = try await transcribe(at: args.audioURL, locale: args.locale)
      FileHandle.standardOutput.write(Data((text + "\n").utf8))
      exit(ExitCode.success.rawValue)
    } catch {
      fail(error)
    }
  }
}
