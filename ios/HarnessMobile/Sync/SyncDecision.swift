import Foundation

enum SyncDirection: String {
    case push
    case pull
    case noop
}

enum SyncDecision {
    case push
    case pull
    case noop
    case conflict

    var direction: SyncDirection? {
        switch self {
        case .push: return .push
        case .pull: return .pull
        case .noop: return .noop
        case .conflict: return nil
        }
    }
}

/// Port of `decideSyncAction` from `src/shared/sync.ts`.
enum SyncDecisionEngine {
    static func decide(params: (
        localRevision: String,
        remoteRevision: String?,
        lastSyncedRevision: String?,
        remoteUpdatedAt: Int64?,
        localMaxMtimeMs: Int64
    )) -> SyncDecision {
        let localRevision = params.localRevision
        let remoteRevision = params.remoteRevision
        let lastSyncedRevision = params.lastSyncedRevision
        let remoteUpdatedAt = params.remoteUpdatedAt
        let localMaxMtimeMs = params.localMaxMtimeMs

        guard let remoteRevision, !remoteRevision.isEmpty else { return .push }
        if localRevision == remoteRevision { return .noop }

        if let lastSyncedRevision {
            if localRevision == lastSyncedRevision { return .pull }
            if remoteRevision == lastSyncedRevision { return .push }
            return .conflict
        }

        if let remoteUpdatedAt, localMaxMtimeMs > remoteUpdatedAt {
            return .conflict
        }
        return .pull
    }
}
