import SwiftUI

/// Windowing for the home conversation list — matches desktop sidebar More controls.
enum ConversationListWindow {
    /// Matches desktop `SIDEBAR_PAGE_SIZE` (initial window and each More click).
    static let pageSize = 25

    static func visibleItems<T>(_ items: [T], limit: Int, searching: Bool) -> [T] {
        if searching { return items }
        guard limit >= 0 else { return [] }
        return Array(items.prefix(limit))
    }

    static func showsMoreControl(totalCount: Int, visibleCount: Int, searching: Bool) -> Bool {
        !searching && visibleCount < totalCount
    }

    static func nextLimit(current: Int, totalCount: Int) -> Int {
        min(totalCount, max(current, 0) + pageSize)
    }
}

struct ConversationListView: View {
    /// Not `@ObservedObject` — observing `AppModel` rebuilds the list on chat route / sync chrome changes.
    let app: AppModel
    @ObservedObject private var store: ConversationStore
    @ObservedObject private var arrivals: RecentlyPulledTracker
    let onSelect: (String) -> Void

    @State private var createError: String?
    @State private var showComposeSheet = false
    @State private var searchQuery = ""
    @State private var visibleLimit = ConversationListWindow.pageSize
    @State private var conversationToRename: ConversationListItem?
    @State private var renameDraft = ""
    @State private var showRenameAlert = false

    init(app: AppModel, onSelect: @escaping (String) -> Void) {
        self.app = app
        self.store = app.store
        self.arrivals = app.store.recentlyPulled
        self.onSelect = onSelect
    }

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filteredConversations: [ConversationListItem] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return store.conversations }
        return store.conversations.filter { $0.displayTitle.lowercased().contains(query) }
    }

    private var visibleConversations: [ConversationListItem] {
        ConversationListWindow.visibleItems(
            filteredConversations,
            limit: visibleLimit,
            searching: isSearching
        )
    }

    var body: some View {
        conversationList
        .refreshable {
            await app.performSync()
            Self.hapticForSyncOutcome(configured: R2SettingsStore.isConfigured, kind: app.syncStatus.kind)
        }
        .navigationTitle("Harness")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    TasksListView(app: app)
                } label: {
                    Image(systemName: "checklist")
                        .foregroundStyle(HarnessPalette.textMuted)
                }
                .accessibilityLabel("Tasks")
            }
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    HomeSyncIndicator(app: app)
                    NavigationLink {
                        MobileSettingsView(app: app)
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(HarnessPalette.textMuted)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: BottomBarMetrics.reservedHeight)
        }
        .overlay(alignment: .bottom) {
            homeBottomBar
                .padding(.horizontal, BottomBarMetrics.horizontalInset)
                .padding(.bottom, BottomBarMetrics.bottomInset)
        }
        .alert("Could not start chat", isPresented: .constant(createError != nil)) {
            Button("OK") { createError = nil }
        } message: {
            Text(createError ?? "")
        }
        .alert("Rename conversation", isPresented: $showRenameAlert) {
            TextField("Title", text: $renameDraft)
            Button("Save") {
                guard let item = conversationToRename else { return }
                renameConversation(id: item.id, title: renameDraft)
            }
            Button("Cancel", role: .cancel) {
                conversationToRename = nil
            }
        }
        .sheet(isPresented: $showComposeSheet) {
            ComposeChatView(app: app) { conversationId in
                showComposeSheet = false
                onSelect(conversationId)
            }
        }
    }

    private var conversationList: some View {
        List {
            if !store.conversations.isEmpty {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .font(.subheadline)
                            .foregroundStyle(HarnessPalette.textFaint)
                        TextField(
                            "",
                            text: $searchQuery,
                            prompt: Text("Search").foregroundStyle(HarnessPalette.textFaint)
                        )
                        .foregroundStyle(HarnessPalette.text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(HarnessPalette.surface)
                    )
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                }
            }

            if store.conversations.isEmpty {
                VStack(spacing: 10) {
                    Text("Nothing here yet")
                        .font(.system(.title3, design: .serif))
                        .foregroundStyle(HarnessPalette.textMuted)
                    Text("Start a new chat, or sync from your Mac in Settings.")
                        .font(.footnote)
                        .foregroundStyle(HarnessPalette.textFaint)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 120)
                .padding(.horizontal, 32)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else if filteredConversations.isEmpty {
                ContentUnavailableView.search(text: searchQuery)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(visibleConversations) { item in
                    conversationRow(item)
                }
                if ConversationListWindow.showsMoreControl(
                    totalCount: filteredConversations.count,
                    visibleCount: visibleConversations.count,
                    searching: isSearching
                ) {
                    Button {
                        visibleLimit = ConversationListWindow.nextLimit(
                            current: visibleLimit,
                            totalCount: filteredConversations.count
                        )
                    } label: {
                        Text("More")
                            .font(.subheadline)
                            .foregroundStyle(HarnessPalette.textMuted)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .accessibilityLabel(
                        "Show \(ConversationListWindow.pageSize) more conversations"
                    )
                }
            }
        }
        .listStyle(.plain)
        .harnessListBackground()
    }

    private var homeBottomBar: some View {
        HStack(spacing: 12) {
            Button {
                HapticFeedback.medium()
                showComposeSheet = true
            } label: {
                Label("New Chat", systemImage: "plus")
                    .labelStyle(.titleAndIcon)
                    .font(.body.weight(.medium))
                    .foregroundStyle(HarnessPalette.text)
                    .padding(.horizontal, BottomBarMetrics.collapsedInnerHorizontal)
                    .padding(.vertical, BottomBarMetrics.collapsedInnerVertical)
                    .frame(maxWidth: .infinity)
                    .liquidGlassSurface(
                        cornerRadius: BottomBarMetrics.collapsedCornerRadius,
                        shadowOffsetY: 6
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New Chat")

            Button {
                HapticFeedback.medium()
                app.beginCreateSessionDictation()
            } label: {
                HarnessIconButtonLabel(systemName: "mic", role: .primary, size: 60, glyphSize: 20)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dictate")
        }
    }

    private func deleteConversation(id: String) {
        do {
            HapticFeedback.warning()
            try app.deleteConversation(id: id)
        } catch {
            createError = error.localizedDescription
        }
    }

    private static func hapticForSyncOutcome(configured: Bool, kind: SyncStatusSnapshot.Kind) {
        guard configured else {
            HapticFeedback.warning()
            return
        }
        switch kind {
        case .error:
            HapticFeedback.error()
        case .idle:
            HapticFeedback.success()
        }
    }

    private func renameConversation(id: String, title: String) {
        do {
            try store.setUserTitle(conversationId: id, title: title)
        } catch {
            createError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func conversationRow(_ item: ConversationListItem) -> some View {
        Button {
            onSelect(item.id)
        } label: {
            ConversationRow(item: item, recentlyPulled: arrivals.contains(item.id))
        }
        .listRowBackground(HarnessPalette.background)
        .listRowSeparatorTint(HarnessPalette.separator)
        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                deleteConversation(id: item.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button {
                conversationToRename = item
                renameDraft = item.displayTitle
                showRenameAlert = true
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
                deleteConversation(id: item.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}

private struct ConversationRow: View {
    let item: ConversationListItem
    var recentlyPulled = false

    var body: some View {
        HStack(spacing: 10) {
            Text(item.displayTitle)
                .font(.body)
                .foregroundStyle(HarnessPalette.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if recentlyPulled {
                Circle()
                    .fill(HarnessPalette.accent)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("Arrived from sync")
            }
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

/// Observes AppModel only for sync chrome — does not rebuild the conversation list.
private struct HomeSyncIndicator: View {
    @ObservedObject var app: AppModel

    var body: some View {
        if app.isSyncing {
            ProgressView()
                .controlSize(.small)
                .tint(HarnessPalette.textMuted)
                .accessibilityLabel("Syncing")
        }
    }
}

#Preview("With conversations") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.populatedApp(withTasks: true)) { _ in }
    }
}

#Preview("Empty") {
    PreviewNavigationRoot {
        ConversationListView(app: PreviewSupport.emptyApp(syncNotConfigured: false, needsAPIKey: false)) { _ in }
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

#Preview("Arrived from sync") {
    PreviewNavigationRoot {
        ConversationListView(
            app: {
                let app = PreviewSupport.populatedApp()
                app.store.recentlyPulled.setForPreview([PreviewSupport.sampleConversationId])
                return app
            }()
        ) { _ in }
    }
}
