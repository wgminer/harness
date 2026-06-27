import SwiftUI

struct MobileSettingsView: View {
    @ObservedObject var app: AppModel
    @StateObject private var recordingPlayer = RecordingPlayer()
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = ""
    @State private var showFolderPicker = false
    @State private var showVoiceMemoImport = false
    @State private var settingsMessage = ""
    @State private var recordingCount = 0
    @State private var recentRecordings: [VoiceRecording] = []
    @State private var retranscribingRecordingId: String?
    @State private var retranscribeError: String?

    var body: some View {
        Form {
            Section("OpenAI") {
                SecureField("API key", text: $apiKey)
                Button("Save API key") {
                    do {
                        try app.saveAPIKey(apiKey)
                        settingsMessage = "Saved to Keychain."
                    } catch {
                        settingsMessage = error.localizedDescription
                    }
                }
                Button("Import from synced settings") {
                    do {
                        if try app.importAPIKeyFromSyncedSettings() {
                            settingsMessage = "Imported API key from backup bundle settings."
                            apiKey = KeychainStore.loadAPIKey() ?? ""
                        } else {
                            settingsMessage = "No API key found in synced settings/settings.json."
                        }
                    } catch {
                        settingsMessage = error.localizedDescription
                    }
                }
            }

            Section("iCloud backup folder") {
                if let path = BookmarkStore.displayPath {
                    Text(path)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("Choose backup folder") {
                    showFolderPicker = true
                }
                Text("Pick the same folder as Harness desktop → Settings → Data → backup folder (e.g. iCloud Drive/Harness).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Sync") {
                Button {
                    Task { await app.performSync() }
                } label: {
                    HStack {
                        Text("Sync now")
                        Spacer()
                        if app.isSyncing {
                            ProgressView()
                        } else if let color = app.settingsAttentionColor {
                            Label("Sync status", systemImage: "circle.fill")
                                .labelStyle(.iconOnly)
                                .foregroundStyle(color)
                                .font(.caption2)
                        }
                    }
                }
                .disabled(app.isSyncing)

                Text(app.syncStatusSummary)
                    .font(.caption)
                    .foregroundStyle(syncSummaryColor)

                if let lastSuccessfulSyncAt = app.lastSuccessfulSyncAt {
                    LabeledContent("Last sync") {
                        Text(lastSuccessfulSyncAt, style: .relative)
                            .foregroundStyle(.secondary)
                    }
                }

                if app.syncStatus.isVisible {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(app.syncStatus.title, systemImage: app.syncStatus.symbolName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(app.syncStatus.tint)
                        if let detail = app.syncStatus.detail {
                            Text(detail)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if app.syncStatus.kind == .error {
                            Text("Sync keeps running in the background when you return to the app. Fix iCloud downloads in Files if needed, then tap Sync now.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section {
                Button("Import Voice Memo") {
                    showVoiceMemoImport = true
                }

                LabeledContent("Saved on device") {
                    Text("\(recordingCount)")
                        .foregroundStyle(.secondary)
                }

                Text(RecordingStorage.displayPath)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("Recordings stay on this device and are not synced to your backup folder.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if recentRecordings.isEmpty {
                    Text("No voice recordings yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(recentRecordings) { recording in
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(recording.url.lastPathComponent)
                                    .font(.subheadline)
                                    .lineLimit(1)

                                Text(recordingDetail(for: recording))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Button {
                                recordingPlayer.toggle(recording)
                            } label: {
                                Image(systemName: recordingPlayer.playingRecordingId == recording.id ? "stop.fill" : "play.fill")
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .accessibilityLabel(recordingPlayer.playingRecordingId == recording.id ? "Stop" : "Play")

                            Spacer(minLength: 8)

                            Button {
                                Task { await retranscribe(recording) }
                            } label: {
                                if retranscribingRecordingId == recording.id {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Text("Retranscribe")
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                            .disabled(retranscribingRecordingId != nil)
                        }
                        .padding(.vertical, 4)
                    }
                }

                if let retranscribeError {
                    Text(retranscribeError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } header: {
                Text("Voice recordings")
            } footer: {
                Text("Retranscribe uses Apple on-device speech when possible, then Whisper if you have an API key.")
            }

            if !settingsMessage.isEmpty {
                Section {
                    Text(settingsMessage)
                        .font(.caption)
                }
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            apiKey = KeychainStore.loadAPIKey() ?? ""
            reloadRecordings()
        }
        .onDisappear {
            recordingPlayer.stop()
        }
        .sheet(isPresented: $showVoiceMemoImport) {
            VoiceMemoImportSheet(app: app, isPresented: $showVoiceMemoImport) { conversationId in
                app.openThread(id: conversationId)
                dismiss()
            }
        }
        .sheet(isPresented: $showFolderPicker) {
            FolderPicker { url in
                _ = url.startAccessingSecurityScopedResource()
                do {
                    try BookmarkStore.saveBookmark(from: url)
                    app.syncNotConfigured = false
                    settingsMessage = "Backup folder linked."
                    Task { await app.performSync(forcePull: true) }
                } catch {
                    settingsMessage = error.localizedDescription
                }
                url.stopAccessingSecurityScopedResource()
            }
        }
    }

    private var syncSummaryColor: Color {
        if app.syncStatus.kind == .error {
            return .red
        }
        if app.showsPendingUploadAttention {
            return .orange
        }
        return .secondary
    }

    private func reloadRecordings() {
        do {
            recordingCount = try RecordingStorage.recordingCount()
            recentRecordings = try RecordingStorage.listRecordings(limit: 3)
        } catch {
            recordingCount = 0
            recentRecordings = []
        }
    }

    private func recordingDetail(for recording: VoiceRecording) -> String {
        let timestamp = recording.recordedAt.formatted(
            .dateTime.month(.abbreviated).day().year().hour().minute()
        )
        if let duration = recording.duration {
            return "\(timestamp) · \(RecordingStorage.formattedDuration(duration))"
        }
        return timestamp
    }

    private func retranscribe(_ recording: VoiceRecording) async {
        retranscribeError = nil
        retranscribingRecordingId = recording.id
        defer { retranscribingRecordingId = nil }

        do {
            let conversationId = try await app.retranscribeRecording(at: recording.url)
            app.openThread(id: conversationId)
            dismiss()
        } catch {
            retranscribeError = error.localizedDescription
        }
    }
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
