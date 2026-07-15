import Foundation

enum MemorySelector {
    static func sortedEntries(memory: [String: String]) -> [(String, String)] {
        memory
            .filter { !$0.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { ($0.key, $0.value) }
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
}
