import SwiftUI

struct MobileSettingsView: View {
    private static let recordingsListLimit = 20

    @ObservedObject var app: AppModel
    @ObservedObject private var store: ConversationStore
    @State private var showSyncPairing = false
    @State private var shareRecording: ShareableRecording?
    @State private var recordings: [VoiceRecording] = []
    @State private var autoSend = TranscriptionSettings.defaults.autoSend
    @State private var cleanupEnabled = TranscriptionSettings.defaults.cleanup.enabled

    init(app: AppModel) {
        self.app = app
        self.store = app.store
    }

    var body: some View {
        Form {
            syncSection
            dictationSection
            recordingsSection
        }
        .navigationTitle("Settings")
        .onAppear {
            reloadDictationToggles()
            reloadRecordings()
        }
        .sheet(isPresented: $showSyncPairing) {
            SyncPairingSheet(app: app, isPresented: $showSyncPairing) {
                app.refreshSetupFlags()
            }
        }
        .sheet(item: $shareRecording) { item in
            ActivityShareSheet(items: [item.url])
        }
    }

    // MARK: - Sync

    @ViewBuilder
    private var syncSection: some View {
        Section {
            Button {
                showSyncPairing = true
            } label: {
                HStack {
                    Text("Scan QR code")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }

            Button {
                Task {
                    guard R2SettingsStore.isConfigured else {
                        HapticFeedback.warning()
                        return
                    }
                    await app.performSync()
                    if app.syncStatus.kind == .error {
                        HapticFeedback.error()
                    } else {
                        HapticFeedback.success()
                    }
                }
            } label: {
                HStack {
                    Text(app.isSyncing ? "Syncing…" : "Sync Now")
                    Spacer()
                    if app.isSyncing {
                        ProgressView()
                            .controlSize(.small)
                    } else if let color = app.settingsAttentionColor {
                        Label("Sync status", systemImage: "circle.fill")
                            .labelStyle(.iconOnly)
                            .foregroundStyle(color)
                            .font(.caption2)
                    }
                }
            }
            .disabled(app.isSyncing || !R2SettingsStore.isConfigured)

            Text(syncStatusLine)
                .font(.caption)
                .foregroundStyle(syncStatusColor)
        } header: {
            Text("Sync")
        }
    }

    // MARK: - Dictation

    @ViewBuilder
    private var dictationSection: some View {
        Section {
            Toggle(
                "Send after dictation",
                isOn: Binding(
                    get: { autoSend },
                    set: { newValue in
                        autoSend = newValue
                        persistDictationToggles(autoSend: newValue, cleanupEnabled: cleanupEnabled)
                    }
                )
            )
            Toggle(
                "Clean up transcripts",
                isOn: Binding(
                    get: { cleanupEnabled },
                    set: { newValue in
                        cleanupEnabled = newValue
                        persistDictationToggles(autoSend: autoSend, cleanupEnabled: newValue)
                    }
                )
            )
        } header: {
            Text("Dictation")
        }
    }

    // MARK: - Recordings

    @ViewBuilder
    private var recordingsSection: some View {
        Section {
            if recordings.isEmpty {
                Text("No recordings yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(recordings) { recording in
                    Button {
                        shareRecording = ShareableRecording(url: recording.url)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(recording.url.lastPathComponent)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(recordingDetail(for: recording))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        } header: {
            Text("Recordings")
        }
    }

    // MARK: - Sync status

    private var syncStatusLine: String {
        _ = store.hasLocalEdits
        if app.isSyncing {
            return "Syncing…"
        }
        if app.syncStatus.isVisible {
            if let detail = app.syncStatus.detail, !detail.isEmpty {
                return "\(app.syncStatus.title) — \(detail)"
            }
            return app.syncStatus.title
        }
        return app.syncStatusSummary
    }

    private var syncStatusColor: Color {
        if app.syncStatus.kind == .error {
            return .red
        }
        if app.showsPendingUploadAttention {
            return .orange
        }
        return .secondary
    }

    // MARK: - Helpers

    private func reloadDictationToggles() {
        let settings = TranscriptionSettings.load(from: app.localDataDir)
        autoSend = settings.autoSend
        cleanupEnabled = settings.cleanup.enabled
    }

    private func persistDictationToggles(autoSend: Bool, cleanupEnabled: Bool) {
        do {
            try TranscriptionSettings.updatePhoneToggles(
                autoSend: autoSend,
                cleanupEnabled: cleanupEnabled,
                in: app.localDataDir
            )
            app.scheduleSyncAfterLocalChange()
            Task { await store.refreshPendingSyncState() }
        } catch {
            HapticFeedback.error()
            reloadDictationToggles()
        }
    }

    private func reloadRecordings() {
        do {
            recordings = try RecordingStorage.listRecordings(limit: Self.recordingsListLimit)
        } catch {
            recordings = []
        }
    }

    private func recordingDetail(for recording: VoiceRecording) -> String {
        let timestamp = recording.recordedAt.formatted(
            .dateTime.month(.abbreviated).day().year()
        )
        if let duration = recording.duration {
            return "\(timestamp) · \(RecordingStorage.formattedDuration(duration))"
        }
        return timestamp
    }
}

private struct ShareableRecording: Identifiable {
    let url: URL
    var id: String { url.path }
}

#Preview("Configured") {
    PreviewNavigationRoot {
        MobileSettingsView(app: PreviewSupport.populatedApp())
    }
}

#Preview("Needs setup") {
    PreviewNavigationRoot {
        MobileSettingsView(app: PreviewSupport.emptyApp())
    }
}

#Preview("Syncing") {
    PreviewNavigationRoot {
        MobileSettingsView(app: PreviewSupport.populatedApp(isSyncing: true))
    }
}
