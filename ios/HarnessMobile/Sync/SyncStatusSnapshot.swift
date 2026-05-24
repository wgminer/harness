import Foundation
import SwiftUI

struct SyncStatusSnapshot: Equatable {
    enum Kind: Equatable {
        case idle
        case syncing
        case upToDate
        case pulled
        case pushed
        case conflict
        case error
    }

    var kind: Kind
    var title: String
    var detail: String?
    var occurredAt: Date?

    var isVisible: Bool {
        kind != .idle
    }

  /// Bottom banner is for transient success/sync progress only; errors use toolbar dots + Settings.
  var showsBanner: Bool {
    switch kind {
    case .idle, .error:
      return false
    default:
      return true
    }
  }

  var showsAttentionDot: Bool {
    switch kind {
    case .error, .conflict:
      return true
    default:
      return false
    }
  }

    var isDismissible: Bool {
        switch kind {
        case .idle, .syncing:
            return false
        default:
            return true
        }
    }

    var symbolName: String {
        switch kind {
        case .idle:
            return "circle"
        case .syncing:
            return "arrow.triangle.2.circlepath"
        case .upToDate:
            return "checkmark.circle.fill"
        case .pulled:
            return "arrow.down.circle.fill"
        case .pushed:
            return "arrow.up.circle.fill"
        case .conflict:
            return "exclamationmark.triangle.fill"
        case .error:
            return "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch kind {
        case .idle, .syncing:
            return .secondary
        case .upToDate:
            return .green
        case .pulled, .pushed:
            return .blue
        case .conflict:
            return .orange
        case .error:
            return .red
        }
    }
}

struct SyncConflictContext: Equatable {
    var localRevision: String?
    var remoteRevision: String?
    var lastSyncedRevision: String?
    var remoteUpdatedAt: Date?
    var hasLocalEdits: Bool
    var conversationCount: Int
}

extension SyncConflictContext {
    static func make(
        localRevision: String?,
        remoteRevision: String?,
        lastSyncedRevision: String?,
        remoteUpdatedAtMs: Int64?,
        hasLocalEdits: Bool,
        conversationCount: Int
    ) -> SyncConflictContext {
        SyncConflictContext(
            localRevision: localRevision,
            remoteRevision: remoteRevision,
            lastSyncedRevision: lastSyncedRevision,
            remoteUpdatedAt: remoteUpdatedAtMs.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) },
            hasLocalEdits: hasLocalEdits,
            conversationCount: conversationCount
        )
    }

    var detailLines: [String] {
        var lines: [String] = []
        if hasLocalEdits {
            lines.append("This phone has unsynced edits.")
        }
        if conversationCount > 0 {
            lines.append("\(conversationCount) conversation\(conversationCount == 1 ? "" : "s") on this phone.")
        }
        if let lastSyncedRevision, !lastSyncedRevision.isEmpty {
            lines.append("Last shared revision: \(shortRevision(lastSyncedRevision)).")
        }
        if let localRevision, !localRevision.isEmpty {
            lines.append("Phone revision: \(shortRevision(localRevision)).")
        }
        if let remoteRevision, !remoteRevision.isEmpty {
            lines.append("Backup revision: \(shortRevision(remoteRevision)).")
        }
        if let remoteUpdatedAt {
            lines.append("Backup updated \(remoteUpdatedAt.formatted(date: .abbreviated, time: .shortened)).")
        }
        return lines
    }

    private func shortRevision(_ revision: String) -> String {
        String(revision.prefix(12))
    }
}
