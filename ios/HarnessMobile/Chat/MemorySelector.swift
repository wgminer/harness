import Foundation

enum MemoryInjectionStrategy: String {
    case all
    case relevant
    case budget
    case none

    static func parse(_ raw: String?) -> MemoryInjectionStrategy {
        guard let raw, let value = MemoryInjectionStrategy(rawValue: raw) else { return .all }
        return value
    }
}

enum MemorySelector {
    private static let stopwords: Set<String> = [
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "how",
        "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the",
        "this", "to", "was", "we", "with", "you", "your",
    ]

    private static let alwaysRelevant = ["writing", "tone", "style", "voice", "goal", "audience", "constraint"]
    private static let relevantMaxEntries = 6
    private static let relevantMaxChars = 900
    private static let relevantMinScore = 0.65
    private static let budgetMaxChars = 900
    private static let relevantFallbackCount = 3

    static func selectForPrompt(
        strategy: MemoryInjectionStrategy,
        memory: [String: String],
        userContent: String
    ) -> [(String, String)] {
        if strategy == .none { return [] }
        let entries = sortedEntries(memory: memory)
        guard !entries.isEmpty else { return [] }

        switch strategy {
        case .all:
            return entries
        case .relevant:
            return selectRelevant(entries: entries, userContent: userContent)
        case .budget:
            return applyCharBudget(rows: entries.map { (key: $0.0, value: $0.1) }, maxChars: budgetMaxChars)
        case .none:
            return []
        }
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
        lines.append("- If uncertain whether memory still applies, ask one brief clarifying question.")
        return lines.joined(separator: "\n")
    }

    private static func sortedEntries(memory: [String: String]) -> [(String, String)] {
        memory
            .filter { !$0.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { ($0.key, $0.value) }
    }

    private static func selectRelevant(entries: [(String, String)], userContent: String) -> [(String, String)] {
        let trimmed = userContent.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return Array(entries.prefix(relevantFallbackCount))
        }

        let userTokens = Set(tokenize(trimmed))
        if userTokens.isEmpty { return Array(entries.prefix(relevantFallbackCount)) }

        let scored = entries
            .map { key, value in (key, value, score(key: key, value: value, userTokens: userTokens)) }
            .filter { $0.2 >= relevantMinScore }
            .sorted { $0.2 > $1.2 }
            .prefix(relevantMaxEntries)
            .map { (key: $0.0, value: $0.1) }

        return applyCharBudget(rows: scored, maxChars: relevantMaxChars)
    }

    private static func applyCharBudget(
        rows: [(key: String, value: String)],
        maxChars: Int
    ) -> [(String, String)] {
        var used = 0
        var selected: [(String, String)] = []
        for row in rows {
            let line = "- \(row.key): \(row.value)"
            if !selected.isEmpty, used + line.count > maxChars { break }
            selected.append((row.key, row.value))
            used += line.count
        }
        return selected
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
