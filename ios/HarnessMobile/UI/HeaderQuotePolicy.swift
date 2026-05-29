import Foundation

/// Rotating quote shown at the top of the conversation list.
/// Uses only saved text clippings.
enum HeaderQuotePolicy {
    static func headerQuote(
        clippings: [ClippingItem],
        rotationIndex: Int = 0
    ) -> String {
        let pool = textClippings(from: clippings).map { formatForHeader($0.content) }
        guard !pool.isEmpty else { return "" }
        let index = ((rotationIndex % pool.count) + pool.count) % pool.count
        return pool[index]
    }

    static func textClippings(from clippings: [ClippingItem]) -> [ClippingItem] {
        clippings.filter { item in
            item.kind == .text && !formatForHeader(item.content).isEmpty
        }
    }

    static func formatForHeader(_ text: String) -> String {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        trimmed = trimmed.replacingOccurrences(
            of: #"\s+"#,
            with: " ",
            options: .regularExpression
        )
        return trimmed
    }
}
