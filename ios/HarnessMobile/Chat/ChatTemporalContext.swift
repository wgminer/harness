import Foundation

enum ChatTemporalContext {
    private static let sentAtPrefix = #"^\[sent_at=[^\]]+\]\n"#

    static func temporalContextBlock(now: Date = Date(), timeZone: TimeZone = .current) -> String {
        let tz = timeZone.identifier
        let formatted = formatCurrentDateTime(now, timeZone: timeZone)
        return """
        [TEMPORAL_CONTEXT]
        Current local date and time (\(tz)): \(formatted)
        When present, a message begins with [sent_at=...] (ISO 8601 UTC) for when it was sent.
        Use sent_at together with the current time above to interpret relative dates and whether discussed future plans, events, or deadlines have already passed.
        """
    }

    static func annotateMessageContentForModel(_ content: String, timestampMs: Int64?) -> String {
        guard let timestampMs else { return content }
        if content.range(of: sentAtPrefix, options: .regularExpression) != nil {
            return content
        }
        let sentAt = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(timestampMs) / 1000))
        return "[sent_at=\(sentAt)]\n\(content)"
    }

    private static func formatCurrentDateTime(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        formatter.dateStyle = .full
        formatter.timeStyle = .long
        return formatter.string(from: date)
    }
}
