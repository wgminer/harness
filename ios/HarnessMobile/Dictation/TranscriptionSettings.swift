import Foundation

struct TranscriptionCleanupSettings: Equatable {
    var enabled: Bool
    var prompt: String
}

struct TranscriptionSettings: Equatable {
    var autoSend: Bool
    var cleanup: TranscriptionCleanupSettings
    var dictionary: [TranscriptionDictionaryEntry]

    static let defaults = TranscriptionSettings(
        autoSend: true,
        cleanup: TranscriptionCleanupSettings(
            enabled: false,
            prompt: """
            Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.
            """
        ),
        dictionary: []
    )

    static func load(from localDataDir: URL) -> TranscriptionSettings {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path),
              let data = try? LocalDataLayout.readRegularFileData(at: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .defaults
        }
        return parse(json)
    }

    static func parse(_ json: [String: Any]) -> TranscriptionSettings {
        var settings = TranscriptionSettings.defaults

        if let recording = json["recording"] as? [String: Any],
           let autoSend = recording["autoSend"] as? Bool {
            settings.autoSend = autoSend
        }

        if let transcription = json["transcription"] as? [String: Any] {
            if let cleanup = transcription["cleanup"] as? [String: Any] {
                if let enabled = cleanup["enabled"] as? Bool {
                    settings.cleanup.enabled = enabled
                }
                if let prompt = cleanup["prompt"] as? String, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    settings.cleanup.prompt = prompt
                }
            }

            if let dictionary = transcription["dictionary"] as? [[String: Any]] {
                settings.dictionary = dictionary.compactMap { entry in
                    guard let from = entry["from"] as? String else { return nil }
                    let to = entry["to"] as? String ?? ""
                    return TranscriptionDictionaryEntry(from: from, to: to)
                }
            }
        }

        return settings
    }

    /// Writes only `recording.autoSend` and `transcription.cleanup.enabled`, preserving other settings keys.
    static func updatePhoneToggles(
        autoSend: Bool,
        cleanupEnabled: Bool,
        in localDataDir: URL
    ) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)

        var root: [String: Any] = [:]
        if FileManager.default.fileExists(atPath: path.path),
           let data = try? LocalDataLayout.readRegularFileData(at: path),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            root = existing
        }

        var recording = root["recording"] as? [String: Any] ?? [:]
        recording["autoSend"] = autoSend
        root["recording"] = recording

        var transcription = root["transcription"] as? [String: Any] ?? [:]
        var cleanup = transcription["cleanup"] as? [String: Any] ?? [:]
        cleanup["enabled"] = cleanupEnabled
        if cleanup["prompt"] == nil {
            cleanup["prompt"] = defaults.cleanup.prompt
        }
        transcription["cleanup"] = cleanup
        root["transcription"] = transcription

        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: path, options: .atomic)
    }
}
