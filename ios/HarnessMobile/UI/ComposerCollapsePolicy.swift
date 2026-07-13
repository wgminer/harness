import Foundation

enum ComposerCollapsePolicy {
    static func isCollapsed(
        allowsCollapse: Bool,
        heldExpanded: Bool,
        isFocused: Bool
    ) -> Bool {
        guard allowsCollapse else { return false }
        return !heldExpanded && !isFocused
    }

    /// Compact bar label; keeps draft visible when minimized.
    static func collapsedLabel(draft: String) -> String {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Type a message…" : trimmed
    }

    static func shouldReleaseExpanded(isFocused: Bool) -> Bool {
        !isFocused
    }
}
