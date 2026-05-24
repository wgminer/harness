import SwiftUI

struct SyncStatusBanner: View {
  let status: SyncStatusSnapshot
  var onDismiss: (() -> Void)?

  var body: some View {
    if status.showsBanner {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: status.symbolName)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(status.tint)
          .frame(width: 20)

        VStack(alignment: .leading, spacing: 2) {
          Text(status.title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
          if let detail = status.detail, !detail.isEmpty {
            Text(detail)
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          if let occurredAt = status.occurredAt, status.kind != .syncing {
            Text(occurredAt, style: .time)
              .font(.caption2)
              .foregroundStyle(.tertiary)
          }
        }

        Spacer(minLength: 0)

        if status.isDismissible, let onDismiss {
          Button {
            onDismiss()
          } label: {
            Image(systemName: "xmark")
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
              .padding(6)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Dismiss sync status")
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(.ultraThinMaterial)
          .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .strokeBorder(status.tint.opacity(0.25), lineWidth: 1)
          }
      }
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
      .transition(.move(edge: .bottom).combined(with: .opacity))
    }
  }
}

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
      return app.syncStatus.kind == .conflict ? .orange : .red
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

#Preview("Pulled") {
  SyncStatusBanner(
    status: SyncStatusSnapshot(
      kind: .pulled,
      title: "Downloaded from backup folder",
      detail: "2 new: Trip planning, Notes · 12 files applied",
      occurredAt: .now
    ),
    onDismiss: {}
  )
  .padding()
}

#Preview("Error") {
  SyncStatusBanner(
    status: SyncStatusSnapshot(
      kind: .error,
      title: "Waiting for iCloud to download bundle.json.gz.",
      detail: "Open Files and wait for the download to finish.",
      occurredAt: .now
    ),
    onDismiss: {}
  )
  .padding()
}
