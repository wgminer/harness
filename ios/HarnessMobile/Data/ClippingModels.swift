import Foundation

enum ClippingKind: String, Codable {
    case text
    case url
    case image
}

struct ClippingItem: Codable, Identifiable, Equatable {
    var id: String
    var kind: ClippingKind
    var content: String
    var tags: [String]
    var createdAt: Int64
    var updatedAt: Int64
}

struct ClippingsState: Codable, Equatable {
    var clippings: [ClippingItem]
}

extension ClippingItem {
    static func fromDesktopJSONObject(_ raw: [String: Any]) -> ClippingItem? {
        guard let id = raw["id"] as? String,
              let content = (raw["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !content.isEmpty
        else { return nil }
        let kindRaw = raw["kind"] as? String ?? "text"
        guard kindRaw == "text", let kind = ClippingKind(rawValue: kindRaw) else { return nil }
        let createdAt = (raw["createdAt"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000)
        let updatedAt = (raw["updatedAt"] as? NSNumber)?.int64Value ?? createdAt
        let tags = normalizeClippingTags(raw["tags"])
        return ClippingItem(
            id: id,
            kind: kind,
            content: content,
            tags: tags,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

func normalizeClippingTags(_ input: [String]) -> [String] {
    normalizeClippingTags(input.map { $0 as Any })
}

func normalizeClippingTags(_ input: Any?) -> [String] {
    guard let array = input as? [Any] else { return [] }
    var out: [String] = []
    var seen = Set<String>()
    for value in array {
        let t = String(describing: value)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: "_", options: .regularExpression)
        guard !t.isEmpty, !seen.contains(t) else { continue }
        seen.insert(t)
        out.append(t)
    }
    return out
}
