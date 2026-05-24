import SwiftUI

struct MobileSettingsView: View {
    @ObservedObject var app: AppModel
    @State private var apiKey = ""
    @State private var showFolderPicker = false
    @State private var settingsMessage = ""

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
                        } else if app.syncStatus.showsAttentionDot {
                            Label("Issue", systemImage: "circle.fill")
                                .labelStyle(.iconOnly)
                                .foregroundStyle(app.syncStatus.kind == .conflict ? .orange : .red)
                                .font(.caption2)
                        } else if app.store.hasLocalEdits {
                            Label("Pending", systemImage: "circle.fill")
                                .labelStyle(.iconOnly)
                                .foregroundStyle(.orange)
                                .font(.caption2)
                        }
                    }
                }
                .disabled(app.isSyncing)

                if let lastSuccessfulSyncAt = app.lastSuccessfulSyncAt {
                    LabeledContent("Last successful sync") {
                        Text(lastSuccessfulSyncAt, style: .relative)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("No successful sync recorded yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if app.store.hasLocalEdits {
                    Text(app.pendingChangesDetail ?? "This phone has unsynced changes.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                if let rev = app.syncEngine.lastSyncedRevision {
                    Text("Last synced revision: \(String(rev.prefix(12)))…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
        }
        .sheet(isPresented: $showFolderPicker) {
            FolderPicker { url in
                _ = url.startAccessingSecurityScopedResource()
                do {
                    try BookmarkStore.saveBookmark(from: url)
                    app.needsBackupFolder = false
                    settingsMessage = "Backup folder linked."
                    Task { await app.performSync(forcePull: true) }
                } catch {
                    settingsMessage = error.localizedDescription
                }
                url.stopAccessingSecurityScopedResource()
            }
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
