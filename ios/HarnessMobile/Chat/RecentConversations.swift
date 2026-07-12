import Foundation

enum RecentConversations {
    static let perChatBodyBudget = 2000
    static let totalBodyBudget = 8000
    static let protectRecentCount = 3

    private struct Candidate {
        let id: String
        let title: String?
        let createdAt: Int64
        let activityAt: Int64
        let messages: [MessageRecord]
    }

    private struct Entry {
        let title: String
        let activityAt: Int64
        var body: String
    }

    @MainActor
    static func buildBlock(store: ConversationStore, excludeConversationId: String?) throws -> String {
        let map = try store.loadConversationMapRaw()
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        var candidates: [Candidate] = []

        for (id, meta) in map {
            if id == excludeConversationId { continue }
            guard meta.hasMessages == true else { continue }
            let messages = try store.loadMessages(conversationId: id)
            if messages.isEmpty { continue }
            let activityAt = conversationActivityAt(messages: messages, createdAt: meta.createdAt)
            let previewBody = cleanDialogueBody(messages: messages, budget: perChatBodyBudget)
            if previewBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            candidates.append(
                Candidate(
                    id: id,
                    title: meta.title,
                    createdAt: meta.createdAt,
                    activityAt: activityAt,
                    messages: messages
                )
            )
        }

        let selected = selectRecentCandidates(candidates, nowMs: nowMs)
        if selected.isEmpty { return "" }

        var entries: [Entry] = selected.map { candidate in
            Entry(
                title: ConversationTitlePolicy.conversationDisplayTitle(
                    title: candidate.title,
                    createdAtMs: candidate.createdAt
                ),
                activityAt: candidate.activityAt,
                body: cleanDialogueBody(messages: candidate.messages, budget: perChatBodyBudget)
            )
        }
        applyTotalBodyBudget(&entries)
        return formatBlock(entries: entries, nowMs: nowMs)
    }

    static func cleanDialogueBody(messages: [MessageRecord], budget: Int) -> String {
        var turns: [(label: String, text: String)] = []
        for message in messages {
            guard message.messageRole == .user || message.messageRole == .assistant else { continue }
            let trimmed = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if message.messageRole == .assistant {
                let hasTools = message.toolCalls?.isEmpty == false
                if hasTools && trimmed.isEmpty { continue }
            }
            let text = ChatTemporalContext.stripSentAtPrefix(trimmed)
            if text.isEmpty { continue }
            let label = message.messageRole == .user ? "User" : "Assistant"
            turns.append((label, text))
        }
        return windowDialogueFromEnd(turns: turns, budget: budget)
    }

    private static func conversationActivityAt(messages: [MessageRecord], createdAt: Int64) -> Int64 {
        messages.compactMap(\.timestamp).max() ?? createdAt
    }

    private static func selectRecentCandidates(_ candidates: [Candidate], nowMs: Int64) -> [Candidate] {
        let sorted = candidates.sorted { $0.activityAt > $1.activityAt }
        let topIds = Set(sorted.prefix(protectRecentCount).map(\.id))
        let todayStart = localDayStartMs(timestampMs: nowMs)
        let todayIds = Set(
            sorted.filter { isSameLocalDay(timestampMs: $0.activityAt, dayStartMs: todayStart) }.map(\.id)
        )
        let selectedIds = topIds.union(todayIds)
        return sorted.filter { selectedIds.contains($0.id) }
    }

    private static func localDayStartMs(timestampMs: Int64) -> Int64 {
        let date = Date(timeIntervalSince1970: TimeInterval(timestampMs) / 1000)
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: date)
        return Int64(start.timeIntervalSince1970 * 1000)
    }

    private static func isSameLocalDay(timestampMs: Int64, dayStartMs: Int64) -> Bool {
        timestampMs >= dayStartMs && timestampMs < dayStartMs + 86_400_000
    }

    private static func windowDialogueFromEnd(turns: [(label: String, text: String)], budget: Int) -> String {
        guard !turns.isEmpty else { return "" }
        var selected: [(label: String, text: String)] = []
        var used = 0

        for turn in turns.reversed() {
            let turnText = formatTurn(label: turn.label, text: turn.text)
            let turnLen = turnText.count
            if turnLen > budget {
                let tail = truncateTail(turn.text, maxChars: budget)
                selected.insert((turn.label, tail), at: 0)
                break
            }
            if !selected.isEmpty, used + turnLen > budget { break }
            selected.insert(turn, at: 0)
            used += turnLen
        }

        if selected.isEmpty, let last = turns.last {
            selected.append((last.label, truncateTail(last.text, maxChars: budget)))
        }

        return selected.map { formatTurn(label: $0.label, text: $0.text) }.joined(separator: "\n\n")
    }

    private static func formatTurn(label: String, text: String) -> String {
        "\(label): \(text)"
    }

    private static func truncateTail(_ text: String, maxChars: Int) -> String {
        if text.count <= maxChars { return text }
        let keep = max(0, maxChars - 1)
        let start = text.index(text.endIndex, offsetBy: -keep)
        return "…" + String(text[start...])
    }

    private static func applyTotalBodyBudget(_ entries: inout [Entry]) {
        var total = entries.reduce(0) { $0 + $1.body.count }
        if total <= totalBodyBudget { return }

        func trimPass(includeProtected: Bool) {
            let protect = min(protectRecentCount, entries.count)
            for index in stride(from: entries.count - 1, through: 0, by: -1) {
                if total <= totalBodyBudget { break }
                if index < protect && !includeProtected { continue }
                let excess = total - totalBodyBudget
                if entries[index].body.count <= excess {
                    total -= entries[index].body.count
                    entries[index].body = ""
                    continue
                }
                let newLen = entries[index].body.count - excess
                entries[index].body = truncateHead(entries[index].body, maxChars: newLen)
                total = entries.reduce(0) { $0 + $1.body.count }
            }
        }

        trimPass(includeProtected: false)
        if total > totalBodyBudget {
            trimPass(includeProtected: true)
        }
    }

    private static func truncateHead(_ text: String, maxChars: Int) -> String {
        if text.count <= maxChars { return text }
        let end = text.index(text.startIndex, offsetBy: max(0, maxChars - 1))
        return String(text[..<end]) + "…"
    }

    private static func formatBlock(entries: [Entry], nowMs: Int64) -> String {
        var lines = [
            "[RECENT_CONVERSATIONS]",
            "Other recent chats for continuity (newest first). Bodies may be truncated.",
            "",
        ]
        for entry in entries where !entry.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("--- \(entry.title)")
            lines.append(formatActivityLine(activityAt: entry.activityAt, nowMs: nowMs))
            lines.append("")
            lines.append(entry.body)
            lines.append("")
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func formatActivityLine(activityAt: Int64, nowMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(activityAt) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.dateFormat = "EEEE, MMMM d, yyyy 'at' h:mm:ss a zzz"
        let absolute = formatter.string(from: date)
        return "Last active: \(absolute) (\(formatRelativeHint(activityAt: activityAt, nowMs: nowMs)))"
    }

    private static func formatRelativeHint(activityAt: Int64, nowMs: Int64) -> String {
        let deltaMs = max(0, nowMs - activityAt)
        let minutes = deltaMs / 60_000
        if minutes < 1 { return "just now" }
        if minutes < 60 { return minutes == 1 ? "1 minute ago" : "\(minutes) minutes ago" }
        let hours = minutes / 60
        if hours < 24 { return hours == 1 ? "1 hour ago" : "\(hours) hours ago" }
        let days = hours / 24
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days) days ago" }
        let weeks = days / 7
        return weeks == 1 ? "1 week ago" : "\(weeks) weeks ago"
    }
}
