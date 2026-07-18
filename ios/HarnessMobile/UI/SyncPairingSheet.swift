import SwiftUI

struct SyncPairingSheet: View {
    @ObservedObject var app: AppModel
    @Binding var isPresented: Bool
    var onApplied: () -> Void

    @State private var pasteCode = ""
    @State private var phase: Phase = .ready
    @State private var statusMessage = ""
    @State private var cameraUnavailable = false

    private enum Phase: Equatable {
        case ready
        case applying
        case success
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Scan the QR from Mac Settings → Data → Show sync QR, or paste the sync code.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    if cameraUnavailable {
                        Text("Camera scanning isn’t available on this device. Paste the sync code below.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    } else {
                        PairingCodeScannerView(
                            onCode: { code in Task { await apply(code: code) } },
                            onUnavailable: { cameraUnavailable = true }
                        )
                        .frame(height: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Paste sync code")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        TextField("harness-pair:1:…", text: $pasteCode, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .lineLimit(3...6)
                        Button("Apply sync code") {
                            Task { await apply(code: pasteCode) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(phase == .applying || pasteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    statusBlock
                }
                .padding(20)
            }
            .navigationTitle("Set up sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                        .disabled(phase == .applying)
                }
            }
        }
        .interactiveDismissDisabled(phase == .applying)
    }

    @ViewBuilder
    private var statusBlock: some View {
        switch phase {
        case .ready:
            EmptyView()
        case .applying:
            HStack(spacing: 8) {
                ProgressView()
                Text(statusMessage.isEmpty ? "Applying…" : statusMessage)
                    .font(.caption)
            }
        case .success:
            Label(statusMessage.isEmpty ? "Synced" : statusMessage, systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.subheadline.weight(.semibold))
        case .failed(let message):
            Text(message)
                .font(.caption)
                .foregroundStyle(.red)
        }
    }

    private func apply(code: String) async {
        phase = .applying
        statusMessage = "Saving credentials…"
        do {
            let payload = try PairingPayload.decode(code)
            R2SettingsStore.accountId = payload.accountId
            R2SettingsStore.bucket = payload.bucket
            R2SettingsStore.prefix = payload.prefix
            R2SettingsStore.accessKeyId = payload.accessKeyId
            try KeychainStore.saveR2SecretAccessKey(payload.secretAccessKey)
            if !payload.openaiApiKey.isEmpty {
                try KeychainStore.saveAPIKey(payload.openaiApiKey)
            }
            app.refreshSetupFlags()

            statusMessage = "Testing connection…"
            guard let store = try? RemoteBackupStore.makeConfigured() else {
                phase = .failed("R2 is not fully configured after applying the code.")
                HapticFeedback.error()
                return
            }
            let result = await store.testConnection()
            guard result.ok else {
                phase = .failed(result.error ?? "R2 connection failed.")
                HapticFeedback.error()
                return
            }

            statusMessage = "Pulling backup…"
            await app.performSync(forcePull: true)
            if app.syncStatus.kind == .error {
                phase = .failed(app.syncStatus.detail ?? app.syncStatus.title)
                HapticFeedback.error()
                return
            }
            statusMessage = "Synced"
            phase = .success
            HapticFeedback.success()
            onApplied()
            try? await Task.sleep(nanoseconds: 800_000_000)
            isPresented = false
        } catch let error as PairingPayload.DecodeError {
            phase = .failed(decodeMessage(error))
            HapticFeedback.error()
        } catch {
            phase = .failed(error.localizedDescription)
            HapticFeedback.error()
        }
    }

    private func decodeMessage(_ error: PairingPayload.DecodeError) -> String {
        switch error {
        case .badPrefix:
            return "That doesn’t look like a Harness sync code."
        case .badEncoding, .badJSON:
            return "Couldn’t read the sync code."
        case .badVersion:
            return "This sync code version isn’t supported. Update the apps."
        case .missingFields(let field):
            return "Sync code is missing \(field)."
        case .expired:
            return "This sync code expired. Show a new QR on the Mac."
        }
    }
}
