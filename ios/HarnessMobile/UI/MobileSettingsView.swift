import SwiftUI

struct MobileSettingsView: View {
    @ObservedObject var app: AppModel
    @StateObject private var recordingPlayer = RecordingPlayer()
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = ""
    @State private var r2AccountId = ""
    @State private var r2Bucket = ""
    @State private var r2Prefix = "harness/"
    @State private var r2AccessKeyId = ""
    @State private var r2SecretAccessKey = ""
    @State private var showVoiceMemoImport = false
    @State private var showSyncPairing = false
    @State private var settingsMessage = ""
    @State private var recordingCount = 0
    @State private var recentRecordings: [VoiceRecording] = []
    @State private var retranscribingRecordingId: String?
    @State private var retranscribeError: String?
    @State private var isTestingR2 = false

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

            Section {
                Button("Set up sync") {
                    showSyncPairing = true
                }
            } header: {
                Text("Sync setup")
            } footer: {
                Text("Scan the QR from Mac Settings → Data → Show sync QR. Manual R2 and API key fields below stay available as a fallback.")
            }

            Section {
                TextField("Account ID", text: $r2AccountId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Bucket", text: $r2Bucket)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Prefix", text: $r2Prefix)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Access Key ID", text: $r2AccessKeyId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Secret Access Key", text: $r2SecretAccessKey)
                Button("Save R2 settings") {
                    saveR2Settings()
                }
                Button {
                    Task { await testR2Connection() }
                } label: {
                    HStack {
                        Text("Test connection")
                        Spacer()
                        if isTestingR2 {
                            ProgressView()
                        }
                    }
                }
                .disabled(isTestingR2)
            } header: {
                Text("Cloudflare R2")
            } footer: {
                Text("Use the same R2 bucket as Harness desktop → Settings → Data. Sync stores bundle.json.gz and manifest.json under the prefix.")
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
                .disabled(app.isSyncing || !R2SettingsStore.isConfigured)

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
                            Text("Check your R2 credentials in Settings, then tap Sync now.")
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

                Text("Recordings stay on this device and are not synced to R2.")
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
            loadR2Fields()
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
        .sheet(isPresented: $showSyncPairing) {
            SyncPairingSheet(app: app, isPresented: $showSyncPairing) {
                apiKey = KeychainStore.loadAPIKey() ?? ""
                loadR2Fields()
                settingsMessage = "Synced from pairing QR."
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

    private func loadR2Fields() {
        r2AccountId = R2SettingsStore.accountId
        r2Bucket = R2SettingsStore.bucket
        r2Prefix = R2SettingsStore.prefix
        r2AccessKeyId = R2SettingsStore.accessKeyId
        r2SecretAccessKey = KeychainStore.loadR2SecretAccessKey() ?? ""
    }

    private func saveR2Settings() {
        R2SettingsStore.accountId = r2AccountId
        R2SettingsStore.bucket = r2Bucket
        R2SettingsStore.prefix = r2Prefix
        R2SettingsStore.accessKeyId = r2AccessKeyId
        do {
            let trimmedSecret = r2SecretAccessKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedSecret.isEmpty {
                try KeychainStore.saveR2SecretAccessKey(trimmedSecret)
            }
            app.refreshSetupFlags()
            settingsMessage = R2SettingsStore.isConfigured
                ? "R2 settings saved."
                : "Saved fields, but secret access key is required for sync."
        } catch {
            settingsMessage = error.localizedDescription
        }
    }

    private func testR2Connection() async {
        saveR2Settings()
        guard R2SettingsStore.isConfigured else {
            settingsMessage = "Enter account ID, bucket, access key ID, and secret access key."
            return
        }
        isTestingR2 = true
        defer { isTestingR2 = false }
        let store = try? RemoteBackupStore.makeConfigured()
        guard let store else {
            settingsMessage = "R2 is not fully configured."
            return
        }
        let result = await store.testConnection()
        if result.ok {
            settingsMessage = "R2 connection OK."
            await app.performSync(forcePull: true)
        } else {
            settingsMessage = result.error ?? "R2 connection failed."
        }
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
