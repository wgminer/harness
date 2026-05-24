import Foundation

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct MessageRecord: Codable, Identifiable, Equatable {
    var id: String { "\(role)-\(timestamp ?? 0)-\(content.hashValue)" }
    let role: String
    let content: String
    let timestamp: Int64?
    let model: String?

    var messageRole: MessageRole {
        MessageRole(rawValue: role) ?? .user
    }
}

struct ConversationMeta: Codable, Equatable {
    var title: String?
    var createdAt: Int64
    var sessionKind: String?
    var hasAssistantReply: Bool?
    var titleSource: String?

    /// Parses desktop `conversations.json` entries, tolerating missing or numeric `createdAt`.
    static func fromDesktopJSONObject(_ object: Any) -> ConversationMeta? {
        guard let dict = object as? [String: Any] else { return nil }
        let createdAt = parseTimestamp(dict["createdAt"])
            ?? Int64(Date().timeIntervalSince1970 * 1000)
        let title = dict["title"] as? String
        let sessionKind = dict["sessionKind"] as? String
        let titleSource = dict["titleSource"] as? String
        let hasAssistantReply = dict["hasAssistantReply"] as? Bool
        return ConversationMeta(
            title: title,
            createdAt: createdAt,
            sessionKind: sessionKind,
            hasAssistantReply: hasAssistantReply,
            titleSource: titleSource
        )
    }

    private static func parseTimestamp(_ value: Any?) -> Int64? {
        switch value {
        case let n as Int64:
            return n
        case let n as Int:
            return Int64(n)
        case let n as Double where n.isFinite:
            return Int64(n)
        case let n as NSNumber:
            return n.int64Value
        default:
            return nil
        }
    }
}

struct ConversationListItem: Identifiable, Equatable {
    let id: String
    let title: String?
    let createdAt: Int64
    let hasAssistantReply: Bool

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }
        let date = Date(timeIntervalSince1970: TimeInterval(createdAt) / 1000)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
