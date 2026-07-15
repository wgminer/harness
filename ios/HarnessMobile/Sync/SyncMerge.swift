import Foundation

/// Mirrors `src/shared/syncMerge.ts` — per-file merge for sync conflicts.
enum SyncFileChoice: String, Equatable {
    case local
    case remote
    case merge
}

enum SyncFileChangeKind: String, Equatable {
    case unchanged
    case localOnly = "local-only"
    case remoteOnly = "remote-only"
    case conflict
}

struct SyncConflictFileEntry: Equatable {
    let path: String
    let kind: SyncFileChangeKind
    let defaultChoice: SyncFileChoice
    let supportsMerge: Bool
    let label: String
}

struct SyncConflictReview: Equatable {
    struct Summary: Equatable {
        var unchanged: Int
        var localOnly: Int
        var remoteOnly: Int
        var conflict: Int
    }

    let files: [SyncConflictFileEntry]
    let summary: Summary
}

enum SyncMerge {
    private static let mergeablePaths: Set<String> = [
        "app-state/conversations.json",
        "app-state/tasks.json",
        "app-state/user_memory.json",
        "settings/settings.json",
    ]

    /// Legacy paths that may appear in old sync bundles; ignore rather than fail.
    private static let ignoredSyncPaths: Set<String> = [
        "app-state/plans.json",
    ]

    static func buildConflictReview(
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) -> SyncConflictReview {
        let paths = Set(localFiles.keys).union(remoteFiles.keys).sorted()
        var files: [SyncConflictFileEntry] = []
        var summary = SyncConflictReview.Summary(
            unchanged: 0,
            localOnly: 0,
            remoteOnly: 0,
            conflict: 0
        )

        for path in paths {
            if ignoredSyncPaths.contains(path) { continue }
            let local = localFiles[path]
            let remote = remoteFiles[path]
            let kind: SyncFileChangeKind
            if let local, let remote {
                kind = fileBytesEqual(local, remote) ? .unchanged : .conflict
            } else if local != nil {
                kind = .localOnly
            } else {
                kind = .remoteOnly
            }

            switch kind {
            case .unchanged: summary.unchanged += 1
            case .localOnly: summary.localOnly += 1
            case .remoteOnly: summary.remoteOnly += 1
            case .conflict: summary.conflict += 1
            }

            files.append(SyncConflictFileEntry(
                path: path,
                kind: kind,
                defaultChoice: defaultChoice(for: kind, path: path),
                supportsMerge: supportsMerge(for: path),
                label: label(for: path)
            ))
        }

        return SyncConflictReview(files: files, summary: summary)
    }

    static func buildDefaultMergeChoices(review: SyncConflictReview) -> [String: SyncFileChoice] {
        var choices: [String: SyncFileChoice] = [:]
        for file in review.files {
            if file.kind == .unchanged {
                choices[file.path] = .local
            } else {
                choices[file.path] = file.defaultChoice
            }
        }
        return choices
    }

    static func mergeWarning(from review: SyncConflictReview) -> String? {
        let skipped = review.files.filter { $0.kind == .conflict && !$0.supportsMerge }
        guard !skipped.isEmpty else { return nil }
        let labels = skipped.map(\.label).joined(separator: ", ")
        return "Some files could not be merged (\(labels)); this device's copies were kept."
    }

    static func buildMergedFileMap(
        localFiles: [String: Data],
        remoteFiles: [String: Data],
        choices: [String: SyncFileChoice]
    ) -> [String: Data] {
        let paths = Set(localFiles.keys).union(remoteFiles.keys).sorted()
        var merged: [String: Data] = [:]
        for path in paths {
            if ignoredSyncPaths.contains(path) { continue }
            let local = localFiles[path]
            let remote = remoteFiles[path]
            let kind: SyncFileChangeKind = {
                if let local, let remote {
                    return fileBytesEqual(local, remote) ? .unchanged : .conflict
                }
                if local != nil { return .localOnly }
                return .remoteOnly
            }()
            let choice = choices[path] ?? defaultChoice(for: kind, path: path)
            if let bytes = resolveFileBytes(path: path, choice: choice, local: local, remote: remote) {
                merged[path] = bytes
            }
        }
        return merged
    }

    static func mergeFileBytes(path: String, local: Data, remote: Data) -> Data {
        if path == "app-state/tasks.json" {
            return mergeTasksJson(local: local, remote: remote)
        }
        if path.hasPrefix("app-state/messages_") {
            return mergeMessagesJson(local: local, remote: remote)
        }
        if path == "settings/settings.json" {
            return mergeSettingsJson(local: local, remote: remote)
        }
        if path.hasSuffix(".json"),
           let localObj = parseJSONObject(local),
           let remoteObj = parseJSONObject(remote) {
            return encodeJSON(mergeJsonRecords(local: localObj, remote: remoteObj))
        }
        return local.count >= remote.count ? local : remote
    }

    // MARK: - Private

    private static func fileBytesEqual(_ a: Data, _ b: Data) -> Bool {
        a == b
    }

    private static func supportsMerge(for path: String) -> Bool {
        if mergeablePaths.contains(path) { return true }
        if path.hasPrefix("app-state/messages_") { return true }
        return false
    }

    private static func defaultChoice(for kind: SyncFileChangeKind, path: String) -> SyncFileChoice {
        switch kind {
        case .localOnly, .unchanged:
            return .local
        case .remoteOnly:
            return .remote
        case .conflict:
            return supportsMerge(for: path) ? .merge : .local
        }
    }

    private static func label(for path: String) -> String {
        if path.hasPrefix("app-state/notes/") {
            let name = String(path.dropFirst("app-state/notes/".count))
            return name.hasSuffix(".md") ? String(name.dropLast(3)) : name
        }
        if path.hasPrefix("app-state/messages_") {
            return String(path.dropFirst("app-state/".count))
        }
        switch path {
        case "app-state/conversations.json": return "Conversation list"
        case "app-state/tasks.json": return "Tasks"
        case "app-state/user_memory.json": return "User context"
        case "app-state/writing.md": return "Writing surface"
        case "settings/settings.json": return "App preferences"
        default:
            return path
        }
    }

    private static func resolveFileBytes(
        path: String,
        choice: SyncFileChoice,
        local: Data?,
        remote: Data?
    ) -> Data? {
        switch choice {
        case .local:
            return local
        case .remote:
            return remote
        case .merge:
            guard let local, let remote else { return local ?? remote }
            return mergeFileBytes(path: path, local: local, remote: remote)
        }
    }

    private static func parseJSONObject(_ data: Data) -> [String: Any]? {
        guard let value = try? JSONSerialization.jsonObject(with: data),
              let object = value as? [String: Any]
        else { return nil }
        return object
    }

    private static func parseJSONArray(_ data: Data) -> [Any]? {
        guard let value = try? JSONSerialization.jsonObject(with: data),
              let array = value as? [Any]
        else { return nil }
        return array
    }

    private static func encodeJSON(_ object: Any) -> Data {
        CanonicalJson.encodePretty(object)
    }

    private static func jsonEqual(_ a: Any, _ b: Any) -> Bool {
        // Wrap in a single-element array so that primitive top-level values
        // (String/Number/Bool) don't trip JSONSerialization's "Invalid top-level
        // type" NSException — that exception is raised before the Swift bridge
        // can convert it to a throwable error, so `try?` cannot catch it.
        let wrappedA: [Any] = [a]
        let wrappedB: [Any] = [b]
        guard JSONSerialization.isValidJSONObject(wrappedA),
              JSONSerialization.isValidJSONObject(wrappedB),
              let da = try? JSONSerialization.data(withJSONObject: wrappedA, options: [.sortedKeys]),
              let db = try? JSONSerialization.data(withJSONObject: wrappedB, options: [.sortedKeys])
        else { return false }
        return da == db
    }

    private static func tsFromValue(_ value: Any?) -> Int64 {
        guard let obj = value as? [String: Any] else { return 0 }
        for key in ["updatedAt", "createdAt"] {
            if let n = obj[key] as? Int64 { return n }
            if let n = obj[key] as? Int { return Int64(n) }
            if let n = obj[key] as? Double { return Int64(n) }
            if let n = obj[key] as? NSNumber { return n.int64Value }
        }
        return 0
    }

    private static func mergeJsonRecords(local: [String: Any], remote: [String: Any]) -> [String: Any] {
        var merged = remote
        for (key, localValue) in local {
            guard let remoteValue = merged[key] else {
                merged[key] = localValue
                continue
            }
            if jsonEqual(remoteValue, localValue) { continue }
            merged[key] = tsFromValue(localValue) >= tsFromValue(remoteValue) ? localValue : remoteValue
        }
        return merged
    }

    private static func mergeTasksJson(local: Data, remote: Data) -> Data {
        let localState = parseJSONObject(local) ?? [:]
        let remoteState = parseJSONObject(remote) ?? [:]
        let localTasks = localState["tasks"] as? [Any] ?? []
        let remoteTasks = remoteState["tasks"] as? [Any] ?? []

        var byId: [String: [String: Any]] = [:]
        for row in remoteTasks {
            guard let obj = row as? [String: Any], let id = obj["id"] as? String else { continue }
            byId[id] = obj
        }
        for row in localTasks {
            guard let obj = row as? [String: Any], let id = obj["id"] as? String else { continue }
            if let existing = byId[id] {
                byId[id] = tsFromValue(obj) >= tsFromValue(existing) ? obj : existing
            } else {
                byId[id] = obj
            }
        }
        let tasks = byId.values.sorted { tsFromValue($0) > tsFromValue($1) }
        return encodeJSON(["tasks": tasks])
    }

    private static func mergeMessagesJson(local: Data, remote: Data) -> Data {
        let localRows = parseJSONArray(local) ?? []
        let remoteRows = parseJSONArray(remote) ?? []
        var seen = Set<String>()
        var merged: [Any] = []
        for row in remoteRows + localRows {
            guard JSONSerialization.isValidJSONObject(row),
                  let stamp = CanonicalJson.encodeCompactStamp(row)
            else { continue }
            if seen.contains(stamp) { continue }
            seen.insert(stamp)
            merged.append(row)
        }
        merged.sort { tsFromValue($0) < tsFromValue($1) }
        return encodeJSON(merged)
    }

    private static func mergeSettingsJson(local: Data, remote: Data) -> Data {
        let localObj = parseJSONObject(local) ?? [:]
        let remoteObj = parseJSONObject(remote) ?? [:]
        var merged = mergeJsonRecords(local: localObj, remote: remoteObj)
        if let sync = localObj["sync"] {
            merged["sync"] = sync
        }
        merged = SettingsSecrets.stripSettingsSecrets(merged)
        return encodeJSON(merged)
    }
}
