import SwiftUI

struct ConversationListView: View {
    @ObservedObject var app: AppModel
    @ObservedObject private var store: ConversationStore
    let onSelect: (String) -> Void

    @State private var createError: String?
    @State private var showDictationSheet = false
    @State private var searchQuery = ""
    @State private var conversationToRename: ConversationListItem?
    @State private var renameDraft = ""
    @State private var showRenameAlert = false

    init(app: AppModel, onSelect: @escaping (String) -> Void) {
        self.app = app
        self.store = app.store
        self.onSelect = onSelect
    }

    private var filteredConversations: [ConversationListItem] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return store.conversations }
        return store.conversations.filter { $0.displayTitle.lowercased().contains(query) }
    }

    var body: some View {
        conversationList
        .labeledRefreshable("Pull to sync") {
            await app.performSync()
        }
        .navigationTitle("Harness")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    TasksListView(app: app)
                } label: {
                    Image(systemName: "list.bullet.clipboard")
                }
                .accessibilityLabel("Tasks")
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    MobileSettingsView(app: app)
                } label: {
                    Image(systemName: "gearshape")
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
        .sheet(isPresented: $showDictationSheet) {
            DictationRecordingSheet(
                app: app,
                mode: .createSession,
                isPresented: $showDictationSheet,
                onConversationCreated: { conversationId in
                    onSelect(conversationId)
                }
            )
        }
    }

    private var conversationList: some View {
        List {
            if !store.conversations.isEmpty {
                Section {
                    TextField("Search conversations…", text: $searchQuery)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }

            if store.conversations.isEmpty {
                ContentUnavailableView(
                    "No conversations",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Start a new chat or sync from R2 in Settings.")
                )
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else if filteredConversations.isEmpty {
                ContentUnavailableView.search(text: searchQuery)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            } else {
                ForEach(filteredConversations) { item in
                    conversationRow(item)
                }
            }
        }
        .listStyle(.plain)
    }

    private var homeBottomBar: some View {
        HStack(spacing: 12) {
            Button {
                createNewChat()
            } label: {
                Label("New Chat", systemImage: "plus")
                    .labelStyle(.titleAndIcon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
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
                showDictationSheet = true
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color(.systemBackground))
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Color.red))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dictate")
        }
    }

    private func createNewChat() {
        app.openCompose()
    }

    private func deleteConversation(id: String) {
        do {
            try app.deleteConversation(id: id)
        } catch {
            createError = error.localizedDescription
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
            ConversationRow(item: item)
        }
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

    var body: some View {
        Text(item.displayTitle)
            .font(.headline)
            .foregroundStyle(.primary)
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
