import Foundation

enum SyncScopes {
    static let bundleFormatVersion = 1
    static let manifestVersion = 1
    static let bundleFileName = "bundle.json.gz"
    static let manifestFileName = "manifest.json"

    struct Scope: Sendable {
        let relPath: String
        let kind: Kind

        enum Kind: Sendable {
            case file
            case directory
        }
    }

    /// Matches desktop `DEFAULT_SYNC_SCOPES`.
    static let defaultScopes: [Scope] = [
        Scope(relPath: "app-state", kind: .directory),
        Scope(relPath: "settings/settings.json", kind: .file),
    ]

    /// Matches desktop `USER_CONTENT_SYNC_SCOPES` (excludes settings for conflict detection).
    static let userContentScopes: [Scope] = [
        Scope(relPath: "app-state", kind: .directory),
    ]

    /// Chat MVP push scope: app-state + settings (desktop-compatible bundle).
    static let mobilePushScopes: [Scope] = defaultScopes

    /// Desktop note files synced in the bundle but not kept on device (chat-only MVP).
    static func materializesLocally(_ relPath: String) -> Bool {
        if relPath == "app-state/writing.md" { return false }
        if relPath.hasPrefix("app-state/notes/") && relPath.hasSuffix(".md") { return false }
        return true
    }

    static func isInScope(_ relPath: String, scopes: [Scope]) -> Bool {
        for scope in scopes {
            switch scope.kind {
            case .file:
                if relPath == scope.relPath { return true }
            case .directory:
                if relPath == scope.relPath || relPath.hasPrefix(scope.relPath + "/") {
                    return true
                }
            }
        }
        return false
    }

    static func placeholderSibling(for filename: String) -> String {
        ".\(filename).icloud"
    }
}
