import Combine
import Foundation

struct ConversationSnapshot: Equatable, Codable {
    let id: String
    let title: String?
    let createdAt: Int64
    let hasAssistantReply: Bool
    let messageCount: Int

    var displayTitle: String {
        ConversationTitlePolicy.conversationDisplayTitle(title: title, createdAtMs: createdAt)
    }
}

enum SyncChangeSummary {
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
            return "Everything matches remote backup, but this phone still has changes waiting to upload."
        }
        if conversationCount == 0 {
            return "Up to date with R2. No conversations yet."
        }
        return "Up to date with R2. \(conversationCount) conversation\(conversationCount == 1 ? "" : "s")."
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

    /// Conversation ids that appeared or changed during a pull/merge.
    static func changedConversationIds(
        before: [String: ConversationSnapshot],
        after: [String: ConversationSnapshot]
    ) -> [String] {
        var ids: [String] = []
        for (id, afterSnap) in after {
            guard let beforeSnap = before[id] else {
                ids.append(id)
                continue
            }
            if beforeSnap.title != afterSnap.title
                || beforeSnap.messageCount != afterSnap.messageCount
                || beforeSnap.hasAssistantReply != afterSnap.hasAssistantReply {
                ids.append(id)
            }
        }
        return ids
    }

    /// Human-readable pending changes since the last successful sync.
    static func describePendingLocalChanges(
        baseline: [String: ConversationSnapshot],
        current: [String: ConversationSnapshot]
    ) -> String? {
        guard !baseline.isEmpty else { return nil }
        if let changes = describeConversationChanges(before: baseline, after: current) {
            return changes
        }
        return "Task list changed."
    }
}

@MainActor
final class RecentlyPulledTracker: ObservableObject {
    static let ttl: TimeInterval = 90

    @Published private(set) var ids: Set<String> = []
    private var pulledAt: [String: Date] = [:]

    func mark(_ incoming: [String], now: Date = Date()) {
        guard !incoming.isEmpty else { return }
        pulledAt.merge(incoming.map { ($0, now) }, uniquingKeysWith: { _, new in new })
        prune(now: now)
        ids = Set(pulledAt.keys)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.ttl * 1_000_000_000))
            self?.expire()
        }
    }

    func expire(now: Date = Date()) {
        prune(now: now)
        ids = Set(pulledAt.keys)
    }

    func consume(_ id: String) {
        pulledAt.removeValue(forKey: id)
        ids.remove(id)
    }

    func contains(_ id: String) -> Bool {
        ids.contains(id)
    }

    func setForPreview(_ incoming: [String]) {
        ids = Set(incoming)
        let now = Date()
        pulledAt = Dictionary(uniqueKeysWithValues: incoming.map { ($0, now) })
    }

    private func prune(now: Date) {
        pulledAt = pulledAt.filter { now.timeIntervalSince($0.value) < Self.ttl }
    }
}

enum PendingSyncTracker {
    static let baselineKey = HarnessStorageKeys.syncBaselineConversations

    static func saveBaseline(_ snapshot: [String: ConversationSnapshot]) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: baselineKey)
    }

    static func loadBaseline() -> [String: ConversationSnapshot]? {
        guard let data = UserDefaults.standard.data(forKey: baselineKey) else { return nil }
        return try? JSONDecoder().decode([String: ConversationSnapshot].self, from: data)
    }

    static func clearBaseline() {
        UserDefaults.standard.removeObject(forKey: baselineKey)
    }
}
