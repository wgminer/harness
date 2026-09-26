import Foundation

/// Transcript cleanup prompt + preferred-spellings glossary.
/// Contract: bundled `resources/contracts/transcriptCleanup.json`.
struct TranscriptCleanupContract {
    static let defaults = load()

    let defaultPrompt: String
    let legacyDefaultPrompt: String
    let preferredSpellingsHeader: String

    private static func load() -> TranscriptCleanupContract {
        guard let url = Bundle.main.url(forResource: "transcriptCleanup", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let defaultPrompt = json["defaultPrompt"] as? String, !defaultPrompt.isEmpty,
              let legacyDefaultPrompt = json["legacyDefaultPrompt"] as? String,
              let preferredSpellingsHeader = json["preferredSpellingsHeader"] as? String,
              !preferredSpellingsHeader.isEmpty
        else {
            assertionFailure("resources/contracts/transcriptCleanup.json failed to load or parse from the app bundle")
            return TranscriptCleanupContract(
                defaultPrompt: "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Prefer the listed spellings when the transcript has those terms or close variants. Do not add new information.",
                legacyDefaultPrompt: "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.",
                preferredSpellingsHeader: "Preferred spellings — use these exact forms when the transcript has these terms or close variants:"
            )
        }
        return TranscriptCleanupContract(
            defaultPrompt: defaultPrompt,
            legacyDefaultPrompt: legacyDefaultPrompt,
            preferredSpellingsHeader: preferredSpellingsHeader
        )
    }
}

enum TranscriptGlossary {
    static func migratePrompt(_ prompt: String) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == TranscriptCleanupContract.defaults.legacyDefaultPrompt {
            return TranscriptCleanupContract.defaults.defaultPrompt
        }
        return trimmed
    }

    static func normalize(_ terms: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for item in terms {
            let term = item.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty else { continue }
            let key = term.lowercased()
            if seen.contains(key) { continue }
            seen.insert(key)
            out.append(term)
        }
        return out
    }

    static func fromLegacyDictionary(_ dictionary: [[String: Any]]) -> [String] {
        let terms = dictionary.compactMap { entry -> String? in
            let from = (entry["from"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if let toRaw = entry["to"] as? String {
                let to = toRaw.trimmingCharacters(in: .whitespacesAndNewlines)
                return to.isEmpty ? nil : to
            }
            return from.isEmpty ? nil : from
        }
        return normalize(terms)
    }

    /// Prefer an explicit `glossary` key (even if empty) over legacy `dictionary`.
    static func resolve(from transcription: [String: Any]?) -> [String] {
        guard let transcription else { return [] }
        if let glossary = transcription["glossary"] as? [String] {
            return normalize(glossary)
        }
        if let dictionary = transcription["dictionary"] as? [[String: Any]] {
            return fromLegacyDictionary(dictionary)
        }
        return []
    }

    static func appendPreferredSpellings(prompt: String, terms: [String]) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? TranscriptCleanupContract.defaults.defaultPrompt : trimmed
        guard !terms.isEmpty else { return base }
        let lines = terms.map { "- \($0)" }.joined(separator: "\n")
        return "\(base)\n\n\(TranscriptCleanupContract.defaults.preferredSpellingsHeader)\n\(lines)"
    }
}
