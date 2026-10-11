import CryptoKit
import Foundation

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct MessageAttachment: Codable, Equatable {
    let id: String
    let mimeType: String
    let relativePath: String
}

struct MessageRecord: Codable, Identifiable, Equatable {
    private let cachedId: String
    var id: String { cachedId }
    let role: String
    let content: String
    let timestamp: Int64?
    let model: String?
    let toolCalls: [ToolCallRecord]?
    let attachments: [MessageAttachment]?
    /// Model reasoning summary written by desktop; carried through sync unchanged.
    let reasoning: String?

    init(
        role: String,
        content: String,
        timestamp: Int64?,
        model: String?,
        toolCalls: [ToolCallRecord]? = nil,
        attachments: [MessageAttachment]? = nil,
        reasoning: String? = nil
    ) {
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.model = model
        self.toolCalls = toolCalls
        self.attachments = attachments
        self.reasoning = reasoning
        self.cachedId = Self.makeId(role: role, timestamp: timestamp, content: content)
    }

    enum CodingKeys: String, CodingKey {
        case role, content, timestamp, model, toolCalls, attachments, reasoning
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        timestamp = try container.decodeIfPresent(Int64.self, forKey: .timestamp)
        model = try container.decodeIfPresent(String.self, forKey: .model)
        toolCalls = try container.decodeIfPresent([ToolCallRecord].self, forKey: .toolCalls)
        attachments = try container.decodeIfPresent([MessageAttachment].self, forKey: .attachments)
        reasoning = try container.decodeIfPresent(String.self, forKey: .reasoning)
        cachedId = Self.makeId(role: role, timestamp: timestamp, content: content)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        try container.encodeIfPresent(timestamp, forKey: .timestamp)
        try container.encodeIfPresent(model, forKey: .model)
        try container.encodeIfPresent(toolCalls, forKey: .toolCalls)
        try container.encodeIfPresent(attachments, forKey: .attachments)
        try container.encodeIfPresent(reasoning, forKey: .reasoning)
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

struct ConversationMeta: Equatable {
    var title: String?
    var createdAt: Int64
    var sessionKind: String?
    var hasAssistantReply: Bool?
    var hasMessages: Bool?
    var titleSource: String?
    /// `run` or a vocab word (Summarize / Distill / Breakdown / Proofread).
    var dictationReplyAction: String?
    /// Fields this app does not model (desktop `chatMode`, `codingScope`, import flags, ...).
    /// Kept so phone saves do not drop them.
    var extra: [String: JSONValue] = [:]

    static let knownKeys: Set<String> = [
        "title", "createdAt", "sessionKind", "hasAssistantReply", "hasMessages",
        "titleSource", "dictationReplyAction",
    ]

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
        let dictationReplyAction = dict["dictationReplyAction"] as? String
        return ConversationMeta(
            title: title,
            createdAt: createdAt,
            sessionKind: sessionKind,
            hasAssistantReply: hasAssistantReply,
            hasMessages: hasMessages,
            titleSource: titleSource,
            dictationReplyAction: dictationReplyAction,
            extra: dict
                .filter { !knownKeys.contains($0.key) }
                .mapValues { JSONValue(from: $0) }
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

extension ConversationMeta: Codable {
    private struct AnyKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: AnyKey.self)
        title = try container.decodeIfPresent(String.self, forKey: AnyKey("title"))
        createdAt = try container.decode(Int64.self, forKey: AnyKey("createdAt"))
        sessionKind = try container.decodeIfPresent(String.self, forKey: AnyKey("sessionKind"))
        hasAssistantReply = try container.decodeIfPresent(Bool.self, forKey: AnyKey("hasAssistantReply"))
        hasMessages = try container.decodeIfPresent(Bool.self, forKey: AnyKey("hasMessages"))
        titleSource = try container.decodeIfPresent(String.self, forKey: AnyKey("titleSource"))
        dictationReplyAction = try container.decodeIfPresent(String.self, forKey: AnyKey("dictationReplyAction"))
        var extra: [String: JSONValue] = [:]
        for key in container.allKeys where !Self.knownKeys.contains(key.stringValue) {
            extra[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        self.extra = extra
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: AnyKey.self)
        for (key, value) in extra where !Self.knownKeys.contains(key) {
            try container.encode(value, forKey: AnyKey(key))
        }
        try container.encodeIfPresent(title, forKey: AnyKey("title"))
        try container.encode(createdAt, forKey: AnyKey("createdAt"))
        try container.encodeIfPresent(sessionKind, forKey: AnyKey("sessionKind"))
        try container.encodeIfPresent(hasAssistantReply, forKey: AnyKey("hasAssistantReply"))
        try container.encodeIfPresent(hasMessages, forKey: AnyKey("hasMessages"))
        try container.encodeIfPresent(titleSource, forKey: AnyKey("titleSource"))
        try container.encodeIfPresent(dictationReplyAction, forKey: AnyKey("dictationReplyAction"))
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
