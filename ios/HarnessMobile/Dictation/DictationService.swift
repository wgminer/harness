import Foundation

enum TranscriptionSource: String, Equatable {
    /// Transcript extracted from Apple Voice Memos embedded `tsrp` metadata.
    case appleEmbedded
    /// On-device Apple Speech framework (SFSpeechRecognizer).
    case onDevice
    /// OpenAI Whisper API (explicit cloud option).
    case whisperAPI
}

enum TranscriptionEngine: Equatable {
    /// Apple embedded transcript (optional) then on-device Speech only.
    case onDevice
    /// OpenAI Whisper only (requires API key).
    case whisper
}

enum DictationServiceError: LocalizedError {
    case emptyTranscript
    case transcriptionUnavailable
    case whisperUnavailable

    var errorDescription: String? {
        switch self {
        case .emptyTranscript:
            return "No speech was detected. Try recording again."
        case .transcriptionUnavailable:
            return "Could not transcribe this recording on-device. Retry, or open the recording in Voice Memos so Apple can generate a transcript."
        case .whisperUnavailable:
            return "Cloud transcription needs an OpenAI API key. Add one in Settings, then try again."
        }
    }
}

struct TranscriptionResult: Equatable {
    let text: String
    let source: TranscriptionSource
}

/// Pure routing helpers for tests — default path never selects Whisper.
enum TranscriptionRouting {
    static func defaultEngine() -> TranscriptionEngine { .onDevice }

    static func whisperAvailable(apiKey: String?) -> Bool {
        guard let apiKey else { return false }
        return !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

@MainActor
final class DictationService: ObservableObject {
    private let localDataDir: URL
    private var transcribeTask: Task<TranscriptionResult, Error>?

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    func cancel() {
        transcribeTask?.cancel()
        transcribeTask = nil
    }

    /// Transcribe with on-device Speech (and optional embedded Voice Memo transcript).
    /// Does not call Whisper — use `transcribeRecordingWithWhisper` from the error UI.
    func transcribeRecording(at audioURL: URL, preferEmbeddedTranscript: Bool = true) async throws -> String {
        let result = try await transcribeRecordingDetailed(
            at: audioURL,
            preferEmbeddedTranscript: preferEmbeddedTranscript
        )
        return result.text
    }

    func transcribeRecordingDetailed(
        at audioURL: URL,
        preferEmbeddedTranscript: Bool = true
    ) async throws -> TranscriptionResult {
        try await runTranscription(
            at: audioURL,
            engine: .onDevice,
            preferEmbeddedTranscript: preferEmbeddedTranscript
        )
    }

    /// Explicit Whisper path for the failure-screen “Use Whisper” action.
    func transcribeRecordingWithWhisper(at audioURL: URL) async throws -> String {
        let result = try await runTranscription(
            at: audioURL,
            engine: .whisper,
            preferEmbeddedTranscript: false
        )
        return result.text
    }

    func loadSettings() -> TranscriptionSettings {
        TranscriptionSettings.load(from: localDataDir)
    }

    var hasWhisperAPIKey: Bool {
        TranscriptionRouting.whisperAvailable(apiKey: KeychainStore.loadAPIKey())
    }

    private func runTranscription(
        at audioURL: URL,
        engine: TranscriptionEngine,
        preferEmbeddedTranscript: Bool
    ) async throws -> TranscriptionResult {
        let settings = TranscriptionSettings.load(from: localDataDir)

        let task = Task<TranscriptionResult, Error> {
            let rawResult = try await resolveRawTranscript(
                at: audioURL,
                engine: engine,
                preferEmbeddedTranscript: preferEmbeddedTranscript
            )
            let trimmed = rawResult.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw DictationServiceError.emptyTranscript }

            var processed = trimmed
            if settings.cleanup.enabled, let apiKey = KeychainStore.loadAPIKey(), !apiKey.isEmpty {
                let client = OpenAIClient(apiKey: apiKey)
                do {
                    processed = try await client.cleanupTranscript(
                        text: trimmed,
                        userInstructions: settings.cleanup.prompt
                    )
                } catch {
                    processed = trimmed
                }
            }

            let final = TranscriptDictionary.apply(processed, dictionary: settings.dictionary)
            return TranscriptionResult(text: final, source: rawResult.source)
        }

        transcribeTask = task
        defer { transcribeTask = nil }
        return try await task.value
    }

    private func resolveRawTranscript(
        at audioURL: URL,
        engine: TranscriptionEngine,
        preferEmbeddedTranscript: Bool
    ) async throws -> TranscriptionResult {
        switch engine {
        case .onDevice:
            if preferEmbeddedTranscript, let embedded = VoiceMemoTranscriptExtractor.extract(from: audioURL) {
                let trimmed = embedded.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return TranscriptionResult(text: trimmed, source: .appleEmbedded)
                }
            }

            do {
                let onDevice = try await OnDeviceTranscriber.transcribe(at: audioURL)
                return TranscriptionResult(text: onDevice, source: .onDevice)
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as OnDeviceTranscriberError {
                throw error
            } catch {
                throw DictationServiceError.transcriptionUnavailable
            }

        case .whisper:
            guard let apiKey = KeychainStore.loadAPIKey(), !apiKey.isEmpty else {
                throw DictationServiceError.whisperUnavailable
            }
            let client = OpenAIClient(apiKey: apiKey)
            let whisper = try await client.transcribeAudio(at: audioURL)
            return TranscriptionResult(text: whisper, source: .whisperAPI)
        }
    }
}
