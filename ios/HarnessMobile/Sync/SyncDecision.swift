import Foundation

enum SyncDecision {
    case push
    case pull
    case noop
    case conflict
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

    /// Port of desktop `resolveSyncDecision` — content changes first, then full revision.
    static func resolve(params: (
        localRevision: String,
        localContentRevision: String,
        remoteRevision: String,
        remoteContentRevision: String,
        lastSyncedRevision: String?,
        lastSyncedContentRevision: String?,
        remoteUpdatedAt: Int64?,
        localMaxMtimeMs: Int64
    )) -> SyncDecision {
        if params.localRevision == params.remoteRevision { return .noop }

        let contentDecision = decide(params: (
            localRevision: params.localContentRevision,
            remoteRevision: params.remoteContentRevision,
            lastSyncedRevision: params.lastSyncedContentRevision ?? params.lastSyncedRevision,
            remoteUpdatedAt: params.remoteUpdatedAt,
            localMaxMtimeMs: params.localMaxMtimeMs
        ))
        if contentDecision != .noop { return contentDecision }

        return decide(params: (
            localRevision: params.localRevision,
            remoteRevision: params.remoteRevision,
            lastSyncedRevision: params.lastSyncedRevision,
            remoteUpdatedAt: params.remoteUpdatedAt,
            localMaxMtimeMs: 0
        ))
    }
}
