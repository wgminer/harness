import AVFoundation
import FluidAudio
import Foundation
import Speech

enum ExitCode: Int32 {
  case success = 0
  case general = 1
  case permissionDenied = 2
  case recognizerUnavailable = 3
  case emptyTranscript = 4
  case audioNotReady = 5
  case modelsNotReady = 6
}

enum TranscriptionError: LocalizedError {
  case permissionDenied
  case recognizerUnavailable
  case emptyTranscript
  case audioNotReady
  case modelsNotReady
  case failed(String)

  var exitCode: ExitCode {
    switch self {
    case .permissionDenied: return .permissionDenied
    case .recognizerUnavailable: return .recognizerUnavailable
    case .emptyTranscript: return .emptyTranscript
    case .audioNotReady: return .audioNotReady
    case .modelsNotReady: return .modelsNotReady
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
    case .modelsNotReady:
      return "Parakeet models are not downloaded yet."
    case .failed(let message):
      return message
    }
  }
}

enum Engine: String {
  case apple
  case parakeet
}

enum Mode {
  case transcribe(URL)
  /// Download and compile the engine's models, then exit.
  case prepare
  /// Exit 0 when the engine's models are on disk, `modelsNotReady` otherwise.
  case check
}

struct CLIArgs {
  let mode: Mode
  let engine: Engine
  let locale: Locale
  let modelsDir: URL?
}

let usage = "Usage: HarnessSpeech <wav-path> [--locale <id>] [--engine apple|parakeet] [--models-dir <path>]\n"
  + "       HarnessSpeech --prepare|--check --engine parakeet [--locale <id>] [--models-dir <path>]"

func parseArgs() throws -> CLIArgs {
  let args = CommandLine.arguments.dropFirst()
  var positional: [String] = []
  var locale = Locale.current
  var engine = Engine.apple
  var modelsDir: URL?
  var prepare = false
  var check = false

  func value(for option: String, _ iterator: inout IndexingIterator<ArraySlice<String>>) throws -> String {
    guard let value = iterator.next(), !value.isEmpty else {
      throw TranscriptionError.failed("Missing value for \(option).")
    }
    return value
  }

  var iterator = args.makeIterator()
  while let arg = iterator.next() {
    switch arg {
    case "--locale":
      locale = Locale(identifier: try value(for: arg, &iterator))
    case "--engine":
      let raw = try value(for: arg, &iterator)
      guard let parsed = Engine(rawValue: raw) else {
        throw TranscriptionError.failed("Unknown engine: \(raw)")
      }
      engine = parsed
    case "--models-dir":
      modelsDir = URL(fileURLWithPath: try value(for: arg, &iterator), isDirectory: true)
    case "--prepare":
      prepare = true
    case "--check":
      check = true
    default:
      if arg.hasPrefix("-") {
        throw TranscriptionError.failed("Unknown option: \(arg)")
      }
      positional.append(arg)
    }
  }

  if prepare || check {
    guard engine == .parakeet else {
      throw TranscriptionError.failed("--prepare and --check need --engine parakeet.")
    }
    return CLIArgs(mode: prepare ? .prepare : .check, engine: engine, locale: locale, modelsDir: modelsDir)
  }

  guard let path = positional.first else {
    throw TranscriptionError.failed(usage)
  }
  let url = URL(fileURLWithPath: path)
  guard FileManager.default.fileExists(atPath: url.path) else {
    throw TranscriptionError.failed("Audio file not found: \(path)")
  }
  return CLIArgs(mode: .transcribe(url), engine: engine, locale: locale, modelsDir: modelsDir)
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

/// English uses Parakeet v2 (fastest); other languages use the multilingual Ultra model.
func parakeetVersion(for locale: Locale) -> (version: AsrModelVersion, folder: String) {
  if locale.language.languageCode?.identifier == "en" {
    return (.v2, "parakeet-tdt-0.6b-v2")
  }
  return (.ultra, "parakeet-ultra")
}

/// Model folder in the app's data dir; FluidAudio's own cache location when none is given.
func parakeetModelDirectory(modelsDir: URL?, locale: Locale) -> URL {
  let (version, folder) = parakeetVersion(for: locale)
  guard let modelsDir else { return AsrModels.defaultCacheDirectory(for: version) }
  return modelsDir.appendingPathComponent(folder, isDirectory: true)
}

func parakeetModelsExist(modelsDir: URL?, locale: Locale) -> Bool {
  let version = parakeetVersion(for: locale).version
  return AsrModels.modelsExist(at: parakeetModelDirectory(modelsDir: modelsDir, locale: locale), version: version)
}

func loadParakeetModels(modelsDir: URL?, locale: Locale) async throws -> AsrModels {
  let version = parakeetVersion(for: locale).version
  let directory = parakeetModelDirectory(modelsDir: modelsDir, locale: locale)
  return try await AsrModels.downloadAndLoad(to: directory, version: version)
}

/// CoreML's E5RT runtime prints warnings to stdout, which is the transcript channel.
/// Point fd 1 at stderr while Parakeet runs.
func withStdoutOnStderr<T>(_ body: () async throws -> T) async rethrows -> T {
  fflush(stdout)
  let saved = dup(STDOUT_FILENO)
  dup2(STDERR_FILENO, STDOUT_FILENO)
  defer {
    fflush(stdout)
    dup2(saved, STDOUT_FILENO)
    close(saved)
  }
  return try await body()
}

func transcribeWithParakeet(at url: URL, locale: Locale, modelsDir: URL?) async throws -> String {
  // Downloads are left to `--prepare` so a dictation never waits on a first-run fetch.
  guard parakeetModelsExist(modelsDir: modelsDir, locale: locale) else {
    throw TranscriptionError.modelsNotReady
  }
  try await ensureAudioFileReady(at: url)

  let result = try await withStdoutOnStderr {
    let models = try await loadParakeetModels(modelsDir: modelsDir, locale: locale)
    let manager = AsrManager(config: .default)
    try await manager.loadModels(models)
    var decoderState = try TdtDecoderState(decoderLayers: models.version.decoderLayers)
    return try await manager.transcribe(url, decoderState: &decoderState)
  }

  let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty {
    throw TranscriptionError.emptyTranscript
  }
  return text
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
      switch args.mode {
      case .check:
        guard parakeetModelsExist(modelsDir: args.modelsDir, locale: args.locale) else {
          throw TranscriptionError.modelsNotReady
        }
      case .prepare:
        _ = try await withStdoutOnStderr {
          try await loadParakeetModels(modelsDir: args.modelsDir, locale: args.locale)
        }
      case .transcribe(let url):
        let text: String
        switch args.engine {
        case .apple:
          text = try await transcribe(at: url, locale: args.locale)
        case .parakeet:
          text = try await transcribeWithParakeet(at: url, locale: args.locale, modelsDir: args.modelsDir)
        }
        FileHandle.standardOutput.write(Data((text + "\n").utf8))
      }
      exit(ExitCode.success.rawValue)
    } catch {
      fail(error)
    }
  }
}
