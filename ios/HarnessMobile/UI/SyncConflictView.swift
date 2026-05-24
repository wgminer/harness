import SwiftUI

struct SyncConflictView: View {
    @ObservedObject var app: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Desktop and phone both changed since the last sync.")
                    .font(.headline)
                Text("Choose how to continue, or open Harness on your Mac and resolve sync there.")
                    .foregroundStyle(.secondary)

                if let context = app.syncConflictContext {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(context.detailLines, id: \.self) { line in
                            Label(line, systemImage: "info.circle")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                Button("Replace phone with cloud copy") {
                    Task {
                        await app.performSync(forcePull: true)
                        app.showConflictSheet = false
                        dismiss()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(app.isSyncing)

                Button("Upload phone copy to cloud") {
                    Task {
                        await app.performSync(forcePush: true)
                        app.showConflictSheet = false
                        dismiss()
                    }
                }
                .buttonStyle(.bordered)
                .disabled(app.isSyncing)

                if app.isSyncing {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Resolving conflict…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Sync conflict")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    SyncConflictView(app: {
        let app = PreviewSupport.populatedApp()
        app.showConflictSheet = true
        app.syncConflictContext = SyncConflictContext.make(
            localRevision: "local-revision-hash",
            remoteRevision: "remote-revision-hash",
            lastSyncedRevision: "shared-revision-hash",
            remoteUpdatedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
            hasLocalEdits: true,
            conversationCount: 2
        )
        return app
    }())
}
