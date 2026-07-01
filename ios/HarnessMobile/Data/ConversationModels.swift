import CryptoKit
import Foundation

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct MessageRecord: Codable, Identifiable, Equatable {
    var id: String { "\(role)-\(timestamp ?? 0)-\(Self.stableContentKey(content))" }
    let role: String
    let content: String
    let timestamp: Int64?
    let model: String?
    let toolCalls: [ToolCallRecord]?

    init(
        role: String,
        content: String,
        timestamp: Int64?,
        model: String?,
        toolCalls: [ToolCallRecord]? = nil
    ) {
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.model = model
        self.toolCalls = toolCalls
    }

    var messageRole: MessageRole {
        MessageRole(rawValue: role) ?? .user
    }

    private static func stableContentKey(_ content: String) -> String {
        let digest = SHA256.hash(data: Data(content.utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}

struct ConversationMeta: Codable, Equatable {
    var title: String?
    var createdAt: Int64
    var sessionKind: String?
    var hasAssistantReply: Bool?
    var hasMessages: Bool?
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
        let hasMessages = dict["hasMessages"] as? Bool
        return ConversationMeta(
            title: title,
            createdAt: createdAt,
            sessionKind: sessionKind,
            hasAssistantReply: hasAssistantReply,
            hasMessages: hasMessages,
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
    let hasMessages: Bool

    static func isSidebarVisible(meta: ConversationMeta, messageCount: Int) -> Bool {
        if meta.hasMessages == true { return true }
        return messageCount > 0
    }

    var displayTitle: String {
        ConversationTitlePolicy.conversationDisplayTitle(title: title, createdAtMs: createdAt)
    }
}
