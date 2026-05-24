import Foundation

enum MemorySelector {
    private static let stopwords: Set<String> = [
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "how",
        "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the",
        "this", "to", "was", "we", "with", "you", "your",
    ]

    private static let alwaysRelevant = ["writing", "tone", "style", "voice", "goal", "audience", "constraint"]
    private static let maxEntries = 6
    private static let maxChars = 900
    private static let minScore = 0.65

    static func selectRelevant(memory: [String: String], userContent: String) -> [(String, String)] {
        let entries = memory.filter { !$0.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !entries.isEmpty else { return [] }
        let trimmed = userContent.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return Array(entries.prefix(3).map { ($0.key, $0.value) })
        }

        let userTokens = Set(tokenize(trimmed))
        if userTokens.isEmpty { return Array(entries.prefix(3).map { ($0.key, $0.value) }) }

        let scored = entries
            .map { key, value in (key, value, score(key: key, value: value, userTokens: userTokens)) }
            .filter { $0.2 >= minScore }
            .sorted { $0.2 > $1.2 }
            .prefix(maxEntries)

        var used = 0
        var selected: [(String, String)] = []
        for row in scored {
            let line = "- \(row.0): \(row.1)"
            if !selected.isEmpty, used + line.count > maxChars { break }
            selected.append((row.0, row.1))
            used += line.count
        }
        return selected
    }

    static func formatBlock(selected: [(String, String)]) -> String {
        guard !selected.isEmpty else { return "" }
        var lines = [
            "[USER_MEMORY_CONTEXT]",
            "Use only if relevant to the current request.",
        ]
        for (k, v) in selected {
            lines.append("- \(k): \(v)")
        }
        lines.append("")
        lines.append("[MEMORY_RULES]")
        lines.append("- Treat memory as hints, not absolute truth.")
        lines.append("- If memory conflicts with the user's current message, follow the current message.")
        return lines.joined(separator: "\n")
    }

    private static func tokenize(_ text: String) -> [String] {
        text.lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "_" })
            .map(String.init)
            .filter { $0.count >= 3 && !stopwords.contains($0) }
    }

    private static func score(key: String, value: String, userTokens: Set<String>) -> Double {
        let keyTokens = tokenize(key)
        let valueTokens = tokenize(value)
        let keyMatches = keyTokens.filter { userTokens.contains($0) }.count
        let valueMatches = valueTokens.filter { userTokens.contains($0) }.count
        let norm = sqrt(Double(max(1, keyTokens.count + valueTokens.count)))
        var s = Double(keyMatches * 2 + valueMatches) / norm
        let keyLower = key.lowercased()
        if alwaysRelevant.contains(where: { keyLower.contains($0) }) { s += 1 }
        let extra = max(0, value.count - 260)
        s -= (Double(extra) / 200) * 0.2
        return s
    }
}
