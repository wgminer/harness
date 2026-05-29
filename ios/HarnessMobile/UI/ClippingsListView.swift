import SwiftUI

struct ClippingsListView: View {
    @ObservedObject var app: AppModel
    @State private var activeTag: String?
    @State private var searchQuery = ""
    @State private var showingEditor = false
    @State private var editingItem: ClippingItem?
    @State private var editorContent = ""
    @State private var editorTags = ""
    @State private var errorMessage: String?

    private var filteredItems: [ClippingItem] {
        var items = app.clippingsStore.clippings
        if let activeTag {
            items = items.filter { $0.tags.contains(activeTag) }
        }
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter { item in
            item.content.lowercased().contains(q) ||
                item.tags.contains(where: { $0.contains(q.replacingOccurrences(of: " ", with: "_")) })
        }
    }

    var body: some View {
        List {
            if app.clippingsStore.clippings.isEmpty {
                ContentUnavailableView(
                    "No clippings",
                    systemImage: "doc.on.clipboard",
                    description: Text("Save text snippets with tags to organize them.")
                )
            } else if filteredItems.isEmpty {
                ContentUnavailableView(
                    "No matches",
                    systemImage: "magnifyingglass",
                    description: Text("Try a different search or tag filter.")
                )
            } else {
                ForEach(filteredItems) { item in
                    Button {
                        openEditor(for: item)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.content)
                                .font(.title2)
                                .fontWeight(.semibold)
                                .foregroundStyle(.primary)
                                .lineLimit(4)
                                .multilineTextAlignment(.leading)
                            if !item.tags.isEmpty {
                                FlowLayout(spacing: 6) {
                                    ForEach(item.tags, id: \.self) { tag in
                                        Text(tag.replacingOccurrences(of: "_", with: " "))
                                            .font(.caption)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(Color.secondary.opacity(0.15))
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            deleteItem(item)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Clippings")
        .searchable(text: $searchQuery, prompt: "Search clippings")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editingItem = nil
                    editorContent = ""
                    editorTags = ""
                    showingEditor = true
                } label: {
                    Image(systemName: "plus")
                }
            }
            if !app.clippingsStore.allTags.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("All") { activeTag = nil }
                        ForEach(app.clippingsStore.allTags, id: \.self) { tag in
                            Button(tag.replacingOccurrences(of: "_", with: " ")) {
                                activeTag = tag
                            }
                        }
                    } label: {
                        Label(
                            activeTag?.replacingOccurrences(of: "_", with: " ") ?? "All tags",
                            systemImage: "tag"
                        )
                    }
                }
            }
        }
        .sheet(isPresented: $showingEditor) {
            NavigationStack {
                Form {
                    Section("Content") {
                        TextEditor(text: $editorContent)
                            .frame(minHeight: 120)
                    }
                    Section("Tags") {
                        TextField("Comma-separated tags", text: $editorTags)
                    }
                }
                .navigationTitle(editingItem == nil ? "New clipping" : "Edit clipping")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showingEditor = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { saveEditor() }
                            .disabled(editorContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    if editingItem != nil {
                        ToolbarItem(placement: .destructiveAction) {
                            Button("Delete", role: .destructive) {
                                if let editingItem { deleteItem(editingItem) }
                                showingEditor = false
                            }
                        }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .alert("Could not save clipping", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func openEditor(for item: ClippingItem) {
        editingItem = item
        editorContent = item.content
        editorTags = item.tags.joined(separator: ", ")
        showingEditor = true
    }

    private func saveEditor() {
        let tags = editorTags
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        do {
            if let editingItem {
                try app.clippingsStore.update(id: editingItem.id, content: editorContent, tags: tags)
            } else {
                _ = try app.clippingsStore.create(content: editorContent, tags: tags)
            }
            showingEditor = false
            Task { await app.pushAfterClippingEdit() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteItem(_ item: ClippingItem) {
        do {
            try app.clippingsStore.delete(id: item.id)
            Task { await app.pushAfterClippingEdit() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Simple horizontal tag flow for clipping rows.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), frames)
    }
}
