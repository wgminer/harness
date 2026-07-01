import Foundation

enum TranscriptionSource: String, Equatable {
    /// Transcript extracted from Apple Voice Memos embedded `tsrp` metadata.
    case appleEmbedded
    /// On-device Apple Speech framework (SFSpeechRecognizer).
    case onDevice
    /// OpenAI Whisper API (cloud fallback).
    case whisperAPI
}

enum DictationServiceError: LocalizedError {
    case emptyTranscript
    case transcriptionUnavailable

    var errorDescription: String? {
        switch self {
        case .emptyTranscript:
            return "No speech was detected. Try recording again."
        case .transcriptionUnavailable:
            return "Could not transcribe this recording. Try opening it in Voice Memos first so Apple can generate a transcript, or add an OpenAI API key for cloud transcription."
        }
    }
}

struct TranscriptionResult: Equatable {
    let text: String
    let source: TranscriptionSource
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

    /// Transcribe audio using the best available method, then apply cleanup + dictionary.
    ///
    /// Priority: Apple embedded transcript → on-device Speech → OpenAI Whisper (if API key set).
    func transcribeRecording(at audioURL: URL, preferEmbeddedTranscript: Bool = true) async throws -> String {
        let result = try await transcribeRecordingDetailed(at: audioURL, preferEmbeddedTranscript: preferEmbeddedTranscript)
        return result.text
    }

    func transcribeRecordingDetailed(
        at audioURL: URL,
        preferEmbeddedTranscript: Bool = true
    ) async throws -> TranscriptionResult {
        let settings = TranscriptionSettings.load(from: localDataDir)

        let task = Task<TranscriptionResult, Error> {
            let rawResult = try await resolveRawTranscript(
                at: audioURL,
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

    func loadSettings() -> TranscriptionSettings {
        TranscriptionSettings.load(from: localDataDir)
    }

    private func resolveRawTranscript(
        at audioURL: URL,
        preferEmbeddedTranscript: Bool
    ) async throws -> TranscriptionResult {
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
        } catch {
            // Fall through to cloud Whisper when on-device fails.
        }

        guard let apiKey = KeychainStore.loadAPIKey(), !apiKey.isEmpty else {
            throw DictationServiceError.transcriptionUnavailable
        }

        let client = OpenAIClient(apiKey: apiKey)
        let whisper = try await client.transcribeAudio(at: audioURL)
        return TranscriptionResult(text: whisper, source: .whisperAPI)
    }
}
