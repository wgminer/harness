import CryptoKit
import Foundation

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct MessageRecord: Codable, Identifiable, Equatable {
    private let cachedId: String
    var id: String { cachedId }
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
        self.cachedId = Self.makeId(role: role, timestamp: timestamp, content: content)
    }

    enum CodingKeys: String, CodingKey {
        case role, content, timestamp, model, toolCalls
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        timestamp = try container.decodeIfPresent(Int64.self, forKey: .timestamp)
        model = try container.decodeIfPresent(String.self, forKey: .model)
        toolCalls = try container.decodeIfPresent([ToolCallRecord].self, forKey: .toolCalls)
        cachedId = Self.makeId(role: role, timestamp: timestamp, content: content)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        try container.encodeIfPresent(timestamp, forKey: .timestamp)
        try container.encodeIfPresent(model, forKey: .model)
        try container.encodeIfPresent(toolCalls, forKey: .toolCalls)
    }

    var messageRole: MessageRole {
        MessageRole(rawValue: role) ?? .user
    }

    private static func makeId(role: String, timestamp: Int64?, content: String) -> String {
        "\(role)-\(timestamp ?? 0)-\(stableContentKey(content))"
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
