import SwiftUI

struct SyncAttentionDot: View {
    var color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .offset(x: 4, y: -4)
    }
}

struct SyncToolbarButton: View {
    @ObservedObject var app: AppModel
    var action: () -> Void

    private var attentionColor: Color? {
        if app.syncStatus.showsAttentionDot {
            return .red
        }
        if app.store.hasLocalEdits {
            return .orange
        }
        return nil
    }

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                if app.isSyncing {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }

                if let attentionColor, !app.isSyncing {
                    SyncAttentionDot(color: attentionColor)
                }
            }
        }
        .disabled(app.isSyncing)
        .accessibilityLabel(app.isSyncing ? "Syncing" : "Sync now")
        .accessibilityHint(syncAccessibilityHint)
    }

    private var syncAccessibilityHint: String {
        if app.syncStatus.showsAttentionDot {
            return app.syncStatus.detail ?? app.syncStatus.title
        }
        if app.store.hasLocalEdits {
            return "Unsynced changes on this phone"
        }
        return ""
    }
}

#Preview("Pending edits") {
    SyncToolbarButton(app: PreviewSupport.populatedApp(hasLocalEdits: true)) {}
}

#Preview("Sync error") {
    SyncToolbarButton(
        app: PreviewSupport.populatedApp(
            syncStatus: SyncStatusSnapshot(
                kind: .error,
                title: "Sync failed",
                detail: "Waiting for iCloud to download bundle.json.gz.",
                occurredAt: .now
            )
        )
    ) {}
}
