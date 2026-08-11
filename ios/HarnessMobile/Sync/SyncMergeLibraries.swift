import Foundation

/// Notes + images library merge helpers for `SyncMerge`.
extension SyncMerge {
    static let imagesIndexPath = "app-state/images.json"
    static let imagesDirPrefix = "app-state/images/"
    static let notesIndexPath = "app-state/notes.json"
    static let notesDirPrefix = "app-state/notes/"

    static func isImageLibraryPath(_ path: String) -> Bool {
        path == imagesIndexPath || path.hasPrefix(imagesDirPrefix)
    }

    static func isNoteBodyPath(_ path: String) -> Bool {
        path.hasPrefix(notesDirPrefix) && path.hasSuffix(".md")
    }

    static func noteIdFromBodyPath(_ path: String) -> String? {
        guard isNoteBodyPath(path) else { return nil }
        let id = String(path.dropFirst(notesDirPrefix.count).dropLast(3))
        return id.isEmpty ? nil : id
    }

    static func imageLibraryPaths(
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) -> [String] {
        Set(localFiles.keys).union(remoteFiles.keys).filter(isImageLibraryPath).sorted()
    }

    static func noteBodyPaths(
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) -> [String] {
        Set(localFiles.keys).union(remoteFiles.keys).filter(isNoteBodyPath).sorted()
    }

    static func imageLibraryIsDirty(
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) -> Bool {
        for path in imageLibraryPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
            switch (localFiles[path], remoteFiles[path]) {
            case let (local?, remote?) where !fileBytesEqual(local, remote):
                return true
            case (.some, .none), (.none, .some):
                return true
            default:
                break
            }
        }
        return false
    }

    static func notesAreDirty(
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) -> Bool {
        switch (localFiles[notesIndexPath], remoteFiles[notesIndexPath]) {
        case let (local?, remote?) where !fileBytesEqual(local, remote):
            return true
        case (.some, .none), (.none, .some):
            return true
        default:
            break
        }
        for path in noteBodyPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
            switch (localFiles[path], remoteFiles[path]) {
            case let (local?, remote?) where !fileBytesEqual(local, remote):
                return true
            case (.some, .none), (.none, .some):
                return true
            default:
                break
            }
        }
        return false
    }

    static func applyMergeableLibraryDefaults(
        choices: inout [String: SyncFileChoice],
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) {
        if imageLibraryIsDirty(localFiles: localFiles, remoteFiles: remoteFiles) {
            for path in imageLibraryPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
                switch (localFiles[path], remoteFiles[path]) {
                case (.some, .some): choices[path] = .merge
                case (.some, .none): choices[path] = .local
                case (.none, .some): choices[path] = .remote
                default: break
                }
            }
        }
        if notesAreDirty(localFiles: localFiles, remoteFiles: remoteFiles) {
            choices[notesIndexPath] = .merge
            for path in noteBodyPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
                switch (localFiles[path], remoteFiles[path]) {
                case (.some, .some): choices[path] = .merge
                case (.some, .none): choices[path] = .local
                case (.none, .some): choices[path] = .remote
                default: break
                }
            }
        }
    }

    static func mergeImagesJson(local: Data, remote: Data) -> Data {
        let localState = parseJSONObject(local) ?? [:]
        let remoteState = parseJSONObject(remote) ?? [:]
        let localRows = localState["images"] as? [Any] ?? []
        let remoteRows = remoteState["images"] as? [Any] ?? []
        var byId: [String: [String: Any]] = [:]
        for row in remoteRows {
            guard let obj = row as? [String: Any], let id = obj["id"] as? String else { continue }
            byId[id] = obj
        }
        for row in localRows {
            guard let obj = row as? [String: Any], let id = obj["id"] as? String else { continue }
            if let existing = byId[id] {
                byId[id] = mergeImageRecord(local: obj, remote: existing)
            } else {
                byId[id] = obj
            }
        }
        let images = byId.values.sorted { tsFromValue($0) > tsFromValue($1) }
        return encodeJSON(["images": images])
    }

    static func applyImageLibraryMerge(
        merged: inout [String: Data],
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) {
        guard imageLibraryIsDirty(localFiles: localFiles, remoteFiles: remoteFiles) else {
            for path in imageLibraryPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
                if let bytes = localFiles[path] ?? remoteFiles[path] {
                    merged[path] = bytes
                }
            }
            return
        }
        let mergedIndex: Data
        switch (localFiles[imagesIndexPath], remoteFiles[imagesIndexPath]) {
        case let (local?, remote?):
            mergedIndex = mergeImagesJson(local: local, remote: remote)
        case let (local?, nil):
            mergedIndex = local
        case let (nil, remote?):
            mergedIndex = remote
        default:
            return
        }
        let refs = referencedImageBlobPaths(imagesJson: mergedIndex)
        merged[imagesIndexPath] = mergedIndex
        for path in imageLibraryPaths(localFiles: localFiles, remoteFiles: remoteFiles) where path != imagesIndexPath {
            guard refs.contains(path) else {
                merged.removeValue(forKey: path)
                continue
            }
            switch (localFiles[path], remoteFiles[path]) {
            case let (local?, remote?):
                merged[path] = local.count >= remote.count ? local : remote
            case let (local?, nil):
                merged[path] = local
            case let (nil, remote?):
                merged[path] = remote
            default:
                break
            }
        }
    }

    static func applyNotesMerge(
        merged: inout [String: Data],
        localFiles: [String: Data],
        remoteFiles: [String: Data]
    ) {
        guard notesAreDirty(localFiles: localFiles, remoteFiles: remoteFiles) else {
            if let index = localFiles[notesIndexPath] ?? remoteFiles[notesIndexPath] {
                merged[notesIndexPath] = index
            }
            for path in noteBodyPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
                if let bytes = localFiles[path] ?? remoteFiles[path] {
                    merged[path] = bytes
                }
            }
            return
        }
        let mergedIndex: Data?
        switch (localFiles[notesIndexPath], remoteFiles[notesIndexPath]) {
        case let (local?, remote?):
            mergedIndex = mergeIdArrayJson(local: local, remote: remote, arrayKey: "notes")
        case let (local?, nil):
            mergedIndex = local
        case let (nil, remote?):
            mergedIndex = remote
        default:
            mergedIndex = nil
        }

        var keptIds = Set<String>()
        if let mergedIndex {
            if let state = parseJSONObject(mergedIndex),
               let rows = state["notes"] as? [Any] {
                for row in rows {
                    if let obj = row as? [String: Any], let id = obj["id"] as? String {
                        keptIds.insert(id)
                    }
                }
            }
            merged[notesIndexPath] = mergedIndex
        }

        let localTs = noteTsById(localFiles[notesIndexPath])
        let remoteTs = noteTsById(remoteFiles[notesIndexPath])
        for path in noteBodyPaths(localFiles: localFiles, remoteFiles: remoteFiles) {
            guard let id = noteIdFromBodyPath(path) else { continue }
            if !keptIds.isEmpty && !keptIds.contains(id) {
                merged.removeValue(forKey: path)
                continue
            }
            let bytes: Data?
            switch (localFiles[path], remoteFiles[path]) {
            case let (local?, remote?) where fileBytesEqual(local, remote):
                bytes = local
            case let (local?, remote?):
                let lt = localTs[id] ?? 0
                let rt = remoteTs[id] ?? 0
                bytes = lt >= rt ? local : remote
            case let (local?, nil):
                bytes = local
            case let (nil, remote?):
                bytes = remote
            default:
                bytes = nil
            }
            if let bytes {
                merged[path] = bytes
            }
        }
    }

    private static func mergeImageRecord(local: [String: Any], remote: [String: Any]) -> [String: Any] {
        let localIsNewer = tsFromValue(local) >= tsFromValue(remote)
        let newer = localIsNewer ? local : remote
        let older = localIsNewer ? remote : local
        var versionsById: [String: [String: Any]] = [:]
        for source in [older, newer] {
            let versions = source["versions"] as? [Any] ?? []
            for version in versions {
                guard let obj = version as? [String: Any], let id = obj["id"] as? String else { continue }
                versionsById[id] = obj
            }
        }
        let versions = versionsById.values.sorted { a, b in
            let ta = (a["createdAt"] as? NSNumber)?.int64Value ?? 0
            let tb = (b["createdAt"] as? NSNumber)?.int64Value ?? 0
            if ta != tb { return ta < tb }
            return (a["id"] as? String ?? "") < (b["id"] as? String ?? "")
        }
        var merged = newer
        merged["versions"] = versions
        let active = merged["activeVersionId"] as? String
        let activeOk = active.map { id in versions.contains { ($0["id"] as? String) == id } } ?? false
        if !activeOk, let last = versions.last, let id = last["id"] {
            merged["activeVersionId"] = id
        }
        return merged
    }

    private static func referencedImageBlobPaths(imagesJson: Data) -> Set<String> {
        var out = Set<String>()
        guard let state = parseJSONObject(imagesJson),
              let rows = state["images"] as? [Any]
        else { return out }
        for row in rows {
            guard let obj = row as? [String: Any] else { continue }
            if let name = obj["fileName"] as? String, !name.isEmpty {
                out.insert(imagesDirPrefix + name)
            }
            let versions = obj["versions"] as? [Any] ?? []
            for version in versions {
                guard let v = version as? [String: Any],
                      let name = v["fileName"] as? String,
                      !name.isEmpty
                else { continue }
                out.insert(imagesDirPrefix + name)
            }
        }
        return out
    }

    private static func noteTsById(_ indexBytes: Data?) -> [String: Int64] {
        var out: [String: Int64] = [:]
        guard let indexBytes,
              let state = parseJSONObject(indexBytes),
              let rows = state["notes"] as? [Any]
        else { return out }
        for row in rows {
            guard let obj = row as? [String: Any], let id = obj["id"] as? String else { continue }
            out[id] = tsFromValue(obj)
        }
        return out
    }
}
