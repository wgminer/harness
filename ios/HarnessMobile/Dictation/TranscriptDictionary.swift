import Foundation

struct TranscriptionDictionaryEntry: Equatable {
    let from: String
    let to: String
}

enum TranscriptDictionary {
    /// Word-boundary replacements — port of desktop `applyTranscriptDictionary`.
    static func apply(_ text: String, dictionary: [TranscriptionDictionaryEntry]) -> String {
        guard !text.isEmpty, !dictionary.isEmpty else { return text }
        var next = text
        for entry in dictionary {
            let from = entry.from.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !from.isEmpty else { continue }
            let pattern = "\\b\(NSRegularExpression.escapedPattern(for: from))\\b"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let range = NSRange(next.startIndex ..< next.endIndex, in: next)
            next = regex.stringByReplacingMatches(
                in: next,
                options: [],
                range: range,
                withTemplate: entry.to
            )
        }
        return next
    }
}
