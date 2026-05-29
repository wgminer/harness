import SwiftUI
import UIKit

struct ConversationListView: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var clippingsStore: ClippingsStore
    let onSelect: (String) -> Void

    @State private var createError: String?
    @Environment(\.colorScheme) private var colorScheme

    init(app: AppModel, onSelect: @escaping (String) -> Void) {
        self.app = app
        _clippingsStore = ObservedObject(wrappedValue: app.clippingsStore)
        self.onSelect = onSelect
    }

    private var headerQuote: String {
        HeaderQuotePolicy.headerQuote(
            clippings: clippingsStore.clippings,
            rotationIndex: app.headerQuoteRotationIndex
        )
    }

    var body: some View {
        List {
            headerSection

            if app.store.conversations.isEmpty {
                ContentUnavailableView(
                    "No conversations",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new chat or sync from your Mac backup folder.")
                )
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else {
                ForEach(app.store.conversations) { item in
                    Button {
                        onSelect(item.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.displayTitle)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            if item.hasAssistantReply {
                                Text("Has replies")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Harness")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                SyncToolbarButton(app: app) {
                    Task { await app.performSync() }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    MobileSettingsView(app: app)
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "gearshape")
                        if let settingsAttentionColor {
                            SyncAttentionDot(color: settingsAttentionColor)
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: 84)
        }
        .overlay(alignment: .bottom) {
            newChatPill
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
        }
        .alert("Could not start chat", isPresented: .constant(createError != nil)) {
            Button("OK") { createError = nil }
        } message: {
            Text(createError ?? "")
        }
        .task {
            try? clippingsStore.reload()
        }
    }

    private var headerSection: some View {
        Section {
            VStack(spacing: 12) {
                if !headerQuote.isEmpty {
                    Text(headerQuote)
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(Self.quoteLineSpacing)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity)
                }

                NavigationLink {
                    ClippingsListView(app: app)
                } label: {
                    Label("Clippings", systemImage: "doc.on.clipboard")
                        .font(.subheadline.weight(.medium))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    /// Extra line spacing so total line height ≈ 1.5× the title2 point size.
    private static var quoteLineSpacing: CGFloat {
        let font = UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .title2).pointSize, weight: .semibold)
        let targetLineHeight = font.pointSize * 1.5
        return max(0, targetLineHeight - font.lineHeight)
    }

    private var newChatPill: some View {
        Button {
            Task { await createNewChat() }
        } label: {
            Label("New Chat", systemImage: "plus")
                .labelStyle(.titleAndIcon)
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 22)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
                .background {
                    Capsule(style: .continuous)
                        .fill(.ultraThinMaterial)
                        .overlay {
                            Capsule(style: .continuous)
                                .strokeBorder(
                                    Color.primary.opacity(colorScheme == .dark ? 0.14 : 0.10),
                                    lineWidth: 1
                                )
                        }
                        .overlay(alignment: .top) {
                            Capsule(style: .continuous)
                                .strokeBorder(
                                    Color.white.opacity(colorScheme == .dark ? 0.12 : 0.35),
                                    lineWidth: 1
                                )
                                .blur(radius: 0.5)
                                .mask {
                                    LinearGradient(
                                        colors: [.white, .clear],
                                        startPoint: .top,
                                        endPoint: .center
                                    )
                                }
                                .allowsHitTesting(false)
                        }
                        .shadow(color: .black.opacity(colorScheme == .dark ? 0.35 : 0.14), radius: 24, y: 6)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("New Chat")
    }

    private var settingsAttentionColor: Color? {
        if app.syncStatus.showsAttentionDot {
            return .red
        }
        if app.store.hasLocalEdits {
            return .orange
        }
        return nil
    }

    private func createNewChat() async {
        do {
            let id = try app.store.createConversation()
            onSelect(id)
        } catch {
            createError = error.localizedDescription
        }
    }
}

#Preview("With conversations") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp()) { _ in }
    }
}

#Preview("Empty") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.emptyApp(needsBackupFolder: false, needsAPIKey: false)) { _ in }
    }
}

#Preview("Syncing") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(isSyncing: true)) { _ in }
    }
}

#Preview("Pending edits") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(hasLocalEdits: true)) { _ in }
    }
}
