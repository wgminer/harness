import SwiftUI

struct MobileSettingsView: View {
    enum SettingsTab: String, CaseIterable, Identifiable {
        case general = "General"
        case voice = "Voice"
        case data = "Data"

        var id: String { rawValue }
    }

    @ObservedObject var app: AppModel
    @ObservedObject private var store: ConversationStore
    @StateObject private var recordingPlayer = RecordingPlayer()
    @Environment(\.dismiss) private var dismiss
    @State private var selectedTab: SettingsTab = .general
    @State private var apiKey = ""
    @State private var r2AccountId = ""
    @State private var r2Bucket = ""
    @State private var r2Prefix = "harness/"
    @State private var r2AccessKeyId = ""
    @State private var r2SecretAccessKey = ""
    @State private var showVoiceMemoImport = false
    @State private var showSyncPairing = false
    @State private var generalMessage = ""
    @State private var dataMessage = ""
    @State private var recordingCount = 0
    @State private var recentRecordings: [VoiceRecording] = []
    @State private var retranscribingRecordingId: String?
    @State private var retranscribeError: String?
    @State private var isTestingR2 = false
    @State private var showAdvancedR2 = false

    init(app: AppModel) {
        self.app = app
        self.store = app.store
    }

    var body: some View {
        Form {
            Section {
                Picker("Section", selection: $selectedTab) {
                    ForEach(SettingsTab.allCases) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            }

            switch selectedTab {
            case .general:
                generalPanel
            case .voice:
                voicePanel
            case .data:
                dataPanel
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            apiKey = KeychainStore.loadAPIKey() ?? ""
            loadR2Fields()
            reloadRecordings()
            showAdvancedR2 = shouldExpandAdvancedR2
        }
        .onChange(of: app.syncStatus.kind) { _, kind in
            if kind == .error {
                showAdvancedR2 = true
            }
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
                dataMessage = "Synced from pairing QR."
                showAdvancedR2 = shouldExpandAdvancedR2
            }
        }
    }

    // MARK: - General

    @ViewBuilder
    private var generalPanel: some View {
        Section {
            SecureField("API key", text: $apiKey)
            Button("Save") {
                do {
                    try app.saveAPIKey(apiKey)
                    generalMessage = "Saved to Keychain."
                    HapticFeedback.success()
                } catch {
                    generalMessage = error.localizedDescription
                    HapticFeedback.error()
                }
            }
            Button("Import from synced settings") {
                do {
                    if try app.importAPIKeyFromSyncedSettings() {
                        generalMessage = "Imported API key from backup bundle settings."
                        apiKey = KeychainStore.loadAPIKey() ?? ""
                    } else {
                        generalMessage = "No API key found in synced settings/settings.json."
                    }
                } catch {
                    generalMessage = error.localizedDescription
                }
            }
            if !generalMessage.isEmpty {
                Text(generalMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("OpenAI")
        } footer: {
            Text("Chat and optional cleanup need a key. On-device transcription works without one.")
        }
    }

    // MARK: - Voice

    @ViewBuilder
    private var voicePanel: some View {
        Section {
            Button("Import Voice Memo") {
                showVoiceMemoImport = true
            }

            LabeledContent("On device") {
                Text("\(recordingCount)")
                    .foregroundStyle(.secondary)
            }

            if recentRecordings.isEmpty {
                Text("No voice recordings yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(recentRecordings) { recording in
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(recording.url.lastPathComponent)
                                .font(.subheadline)
                                .lineLimit(1)

                            Text(recordingDetail(for: recording))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer(minLength: 8)

                        Button {
                            recordingPlayer.toggle(recording)
                        } label: {
                            Image(systemName: recordingPlayer.playingRecordingId == recording.id ? "stop.fill" : "play.fill")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(recordingPlayer.playingRecordingId == recording.id ? "Stop" : "Play")

                        Button {
                            Task { await retranscribe(recording) }
                        } label: {
                            if retranscribingRecordingId == recording.id {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Text("Retranscribe")
                                    .font(.subheadline)
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(retranscribingRecordingId != nil)
                    }
                }
            }

            if let retranscribeError {
                Text(retranscribeError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Recordings")
        } footer: {
            Text("Stay on this device. Retranscribe uses on-device speech, then Whisper if you have an API key.")
        }
    }

    // MARK: - Data

    @ViewBuilder
    private var dataPanel: some View {
        Section {
            Button("Set up sync") {
                showSyncPairing = true
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

            Button {
                Task { await testR2Connection() }
            } label: {
                HStack {
                    Text("Test Connection")
                    Spacer()
                    if isTestingR2 {
                        ProgressView()
                    }
                }
            }
            .disabled(isTestingR2)

            if !dataMessage.isEmpty {
                Text(dataMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Backup (R2)")
        } footer: {
            Text("Sync runs automatically in the background. Use Sync Now if another device looks behind. Pair by scanning the QR from Mac Settings → Data.")
        }

        Section {
            DisclosureGroup("Advanced", isExpanded: $showAdvancedR2) {
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
            }
        } footer: {
            Text("Same R2 bucket as desktop.")
        }
    }

    // MARK: - Sync status

    private var syncStatusLine: String {
        // Observe store pending-edit flag directly (no longer forwarded through AppModel).
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

    private var shouldExpandAdvancedR2: Bool {
        if app.syncStatus.kind == .error {
            return true
        }
        let hasAnyField = !r2AccountId.isEmpty || !r2Bucket.isEmpty || !r2AccessKeyId.isEmpty || !r2SecretAccessKey.isEmpty
        return hasAnyField && !R2SettingsStore.isConfigured
    }

    // MARK: - Helpers

    private func loadR2Fields() {
        r2AccountId = R2SettingsStore.accountId
        r2Bucket = R2SettingsStore.bucket
        r2Prefix = R2SettingsStore.prefix
        r2AccessKeyId = R2SettingsStore.accessKeyId
        r2SecretAccessKey = KeychainStore.loadR2SecretAccessKey() ?? ""
    }

    private func saveR2Settings(announce: Bool = true) {
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
            dataMessage = R2SettingsStore.isConfigured
                ? "R2 settings saved."
                : "Saved fields, but secret access key is required for sync."
            guard announce else { return }
            if R2SettingsStore.isConfigured {
                HapticFeedback.success()
            } else {
                HapticFeedback.warning()
            }
        } catch {
            dataMessage = error.localizedDescription
            if announce {
                HapticFeedback.error()
            }
        }
    }

    private func testR2Connection() async {
        saveR2Settings(announce: false)
        guard R2SettingsStore.isConfigured else {
            dataMessage = "Enter account ID, bucket, access key ID, and secret access key."
            showAdvancedR2 = true
            HapticFeedback.warning()
            return
        }
        isTestingR2 = true
        defer { isTestingR2 = false }
        let store = try? RemoteBackupStore.makeConfigured()
        guard let store else {
            dataMessage = "R2 is not fully configured."
            showAdvancedR2 = true
            HapticFeedback.error()
            return
        }
        let result = await store.testConnection()
        if result.ok {
            dataMessage = "R2 connection OK."
            await app.performSync(forcePull: true)
            if app.syncStatus.kind == .error {
                HapticFeedback.error()
            } else {
                HapticFeedback.success()
            }
        } else {
            dataMessage = result.error ?? "R2 connection failed."
            showAdvancedR2 = true
            HapticFeedback.error()
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
