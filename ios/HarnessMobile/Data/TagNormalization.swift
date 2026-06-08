import Foundation

enum TagNormalization {
    static func normalizeTags(_ input: Any?) -> [String] {
        guard let array = input as? [Any] else { return [] }
        var out: [String] = []
        var seen = Set<String>()
        for value in array {
            let trimmed = String(describing: value)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .replacingOccurrences(of: #"\s+"#, with: "_", options: .regularExpression)
            guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            out.append(trimmed)
        }
        return out
    }

    static func addTags(existing: [String], toAdd: Any?) -> [String] {
        normalizeTags(existing + normalizeTags(toAdd))
    }

    static func removeTags(existing: [String], toRemove: Any?) -> [String] {
        let drop = Set(normalizeTags(toRemove))
        guard !drop.isEmpty else { return normalizeTags(existing) }
        return normalizeTags(existing).filter { !drop.contains($0) }
    }

    static func applyTagPatch(existing: [String], patch: [String: Any]) -> [String]? {
        var next = normalizeTags(existing)
        var changed = false

        if let tags = patch["tags"], tags is [Any] {
            let replaced = normalizeTags(tags)
            if replaced != next {
                next = replaced
                changed = true
            }
        }
        if patch["add_tags"] != nil {
            let merged = addTags(existing: next, toAdd: patch["add_tags"])
            if merged != next {
                next = merged
                changed = true
            }
        }
        if patch["remove_tags"] != nil {
            let trimmed = removeTags(existing: next, toRemove: patch["remove_tags"])
            if trimmed != next {
                next = trimmed
                changed = true
            }
        }

        return changed ? next : nil
    }
}
