import Foundation

struct ConversationSnapshot: Equatable {
    let id: String
    let title: String?
    let createdAt: Int64
    let hasAssistantReply: Bool
    let messageCount: Int

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

enum SyncChangeSummary {
    static func describePullChanges(before: [String: ConversationSnapshot], after: [String: ConversationSnapshot], fileCount: Int) -> String {
        let conversationDetail = describeConversationChanges(before: before, after: after)
        if let conversationDetail {
            return "\(conversationDetail) (\(fileCount) files applied)"
        }
        if fileCount > 0 {
            return "Applied \(fileCount) files from backup folder."
        }
        return "Backup folder matched what was already on this phone."
    }

    static func describePush(fileCount: Int, conversationCount: Int) -> String {
        var parts: [String] = []
        if conversationCount > 0 {
            parts.append("\(conversationCount) conversation\(conversationCount == 1 ? "" : "s")")
        }
        if fileCount > 0 {
            parts.append("\(fileCount) file\(fileCount == 1 ? "" : "s")")
        }
        if parts.isEmpty {
            return "Wrote an empty backup bundle."
        }
        return "Uploaded \(parts.joined(separator: " and "))."
    }

    static func describeNoop(hasLocalEdits: Bool, conversationCount: Int) -> String {
        if hasLocalEdits {
            return "Revisions match, but this phone still has unsaved local edits."
        }
        if conversationCount == 0 {
            return "Phone and backup folder match. No conversations yet."
        }
        return "Phone and backup folder match. \(conversationCount) conversation\(conversationCount == 1 ? "" : "s") in sync."
    }

    static func describeConversationChanges(before: [String: ConversationSnapshot], after: [String: ConversationSnapshot]) -> String? {
        let beforeIds = Set(before.keys)
        let afterIds = Set(after.keys)
        let addedIds = afterIds.subtracting(beforeIds).sorted()
        let removedCount = beforeIds.subtracting(afterIds).count
        var updatedTitles: [String] = []

        for id in beforeIds.intersection(afterIds) {
            guard let beforeSnap = before[id], let afterSnap = after[id] else { continue }
            if beforeSnap.title != afterSnap.title
                || beforeSnap.messageCount != afterSnap.messageCount
                || beforeSnap.hasAssistantReply != afterSnap.hasAssistantReply {
                updatedTitles.append(afterSnap.displayTitle)
            }
        }

        var parts: [String] = []
        if !addedIds.isEmpty {
            let names = addedIds.prefix(2).compactMap { after[$0]?.displayTitle }
            let suffix = addedIds.count > 2 ? " and \(addedIds.count - 2) more" : ""
            parts.append("\(addedIds.count) new: \(names.joined(separator: ", "))\(suffix)")
        }
        if removedCount > 0 {
            parts.append("\(removedCount) removed")
        }
        if !updatedTitles.isEmpty {
            let names = updatedTitles.prefix(2).joined(separator: ", ")
            let suffix = updatedTitles.count > 2 ? " and \(updatedTitles.count - 2) more" : ""
            parts.append("\(updatedTitles.count) updated: \(names)\(suffix)")
        }

        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: " · ")
    }
}
