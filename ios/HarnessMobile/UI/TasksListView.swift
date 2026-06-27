import SwiftUI

private enum TaskCompleteTiming {
    /// Keep in sync with `src/shared/motion.ts` (`TASK_COMPLETE_MS`).
    static let ms: Double = 0.36
}

struct TasksListView: View {
    @ObservedObject var app: AppModel

    @State private var newTitle = ""
    @State private var creating = false
    @State private var searchQuery = ""
    @State private var activeOpen = true
    @State private var completedOpen = false
    @State private var completingIds: Set<String> = []
    @State private var modalTask: TaskItem?
    @State private var modalTitle = ""
    @State private var modalStatus: TaskStatus = .pending
    @State private var modalTags: [String] = []
    @State private var tagInput = ""
    @State private var modalSaving = false
    @State private var loadError: String?
    @State private var isReordering = false
    @State private var showClearCompletedConfirm = false

    private var isSearching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filteredTasks: [TaskItem] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return app.tasksStore.tasks }
        let tagQuery = query.replacingOccurrences(of: #"\s+"#, with: "_", options: .regularExpression)
        return app.tasksStore.tasks.filter { task in
            task.title.lowercased().contains(query)
                || TagNormalization.normalizeTags(task.tags).contains { $0.contains(tagQuery) }
        }
    }

    private var activeTasks: [TaskItem] {
        let active = filteredTasks.filter { TaskStatusPolicy.taskIsActive(TaskStatusPolicy.resolveStatus(for: $0)) }
        return TaskOrdering.sorted(active)
    }

    private var completedTasks: [TaskItem] {
        filteredTasks.filter { TaskStatusPolicy.taskIsInCompletedSection(TaskStatusPolicy.resolveStatus(for: $0)) }
    }

    var body: some View {
        List {
            Section {
                TextField("Search tasks…", text: $searchQuery)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section {
                DisclosureGroup(isExpanded: $activeOpen) {
                    if activeTasks.isEmpty {
                        Text(emptyActiveMessage)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(activeTasks) { task in
                            taskRow(task, completing: completingIds.contains(task.id))
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        deleteTask(task.id)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button {
                                        toggleDone(task)
                                    } label: {
                                        Label("Done", systemImage: "checkmark")
                                    }
                                    .tint(.green)

                                    if TaskStatusPolicy.resolveStatus(for: task) != .in_progress {
                                        Button {
                                            setStatus(task.id, status: .in_progress)
                                        } label: {
                                            Label("In Progress", systemImage: "arrow.right.circle")
                                        }
                                        .tint(.blue)
                                    }
                                }
                        }
                        .onMove(perform: moveActiveTasks)
                    }
                } label: {
                    HStack {
                        Text("Active")
                            .font(.headline)
                        Spacer()
                        if !activeTasks.isEmpty {
                            Text("\(activeTasks.count)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if !completedTasks.isEmpty {
                Section {
                    DisclosureGroup(isExpanded: completedExpandedBinding) {
                        ForEach(completedTasks) { task in
                            taskRow(task, completing: false)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        deleteTask(task.id)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    Button {
                                        toggleDone(task)
                                    } label: {
                                        Label("Reopen", systemImage: "arrow.uturn.backward")
                                    }
                                    .tint(.blue)
                                }
                        }
                    } label: {
                        HStack {
                            Text("Completed")
                                .font(.headline)
                            Spacer()
                            Text("\(completedTasks.count)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .environment(\.editMode, .constant(isReordering ? .active : .inactive))
        .navigationTitle("Tasks")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        withAnimation {
                            isReordering.toggle()
                        }
                    } label: {
                        Label(isReordering ? "Done Reordering" : "Reorder", systemImage: "line.3.horizontal")
                    }
                    .disabled(isSearching || activeTasks.isEmpty)

                    if !completedTasks.isEmpty {
                        Button("Clear Completed", role: .destructive) {
                            showClearCompletedConfirm = true
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerDock
        }
        .refreshable {
            await app.performSync()
        }
        .sheet(item: $modalTask) { task in
            editSheet(task)
        }
        .confirmationDialog(
            "Clear completed tasks?",
            isPresented: $showClearCompletedConfirm,
            titleVisibility: .visible
        ) {
            Button("Clear \(completedTasks.count) Tasks", role: .destructive) {
                clearCompleted()
            }
        } message: {
            Text("Completed and cancelled tasks will be removed.")
        }
        .alert("Could not update tasks", isPresented: .constant(loadError != nil)) {
            Button("OK") { loadError = nil }
        } message: {
            Text(loadError ?? "")
        }
    }

    private var completedExpandedBinding: Binding<Bool> {
        Binding(
            get: { isSearching ? true : completedOpen },
            set: { completedOpen = $0 }
        )
    }

    private var emptyActiveMessage: String {
        if app.tasksStore.tasks.isEmpty { return "No tasks yet." }
        if isSearching { return "No active tasks match your search." }
        return "No active tasks."
    }

    private var composerDock: some View {
        VStack(spacing: 10) {
            TextField("Describe the task…", text: $newTitle, axis: .vertical)
                .lineLimit(1 ... 4)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .onSubmit {
                    Task { await createTask() }
                }
            HStack {
                Spacer()
                Button("Add") {
                    Task { await createTask() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(creating || newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.bar)
    }

    private func taskRow(_ task: TaskItem, completing: Bool) -> some View {
        let status = TaskStatusPolicy.resolveStatus(for: task)
        let done = TaskStatusPolicy.taskIsDone(status)
        return HStack(alignment: .top, spacing: 12) {
            Button {
                toggleDone(task)
            } label: {
                Image(systemName: done ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(done ? .primary : .secondary)
            }
            .buttonStyle(.plain)
            .disabled(completing)

            Button {
                openModal(task)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(task.title)
                            .foregroundStyle(.primary)
                            .strikethrough(done)
                        if status == .in_progress {
                            Text("In progress")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.blue.opacity(0.15))
                                .foregroundStyle(.blue)
                                .clipShape(Capsule())
                        }
                    }
                    if !task.tags.isEmpty {
                        TaskTagChips(tags: task.tags)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .disabled(completing)
        }
        .opacity(completing ? 0.45 : 1)
        .animation(.easeOut(duration: TaskCompleteTiming.ms), value: completing)
    }

    private func editSheet(_ task: TaskItem) -> some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $modalTitle, axis: .vertical)
                        .lineLimit(2 ... 6)
                }
                Section("Status") {
                    Picker("Status", selection: $modalStatus) {
                        ForEach(TaskStatus.allCases, id: \.self) { status in
                            Text(TaskOrdering.statusLabel(status)).tag(status)
                        }
                    }
                }
                Section("Tags") {
                    Text("Press Return to add. Underscores show as spaces in the list.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !modalTags.isEmpty {
                        TaskTagEditor(tags: $modalTags)
                    }
                    TextField("e.g. in progress, urgent", text: $tagInput)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { addModalTagFromInput() }
                }
            }
            .navigationTitle("Edit task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .destructiveAction) {
                    Button("Delete", role: .destructive) {
                        Task { await deleteFromModal() }
                    }
                    .disabled(modalSaving)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { modalTask = nil }
                        .disabled(modalSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(modalSaving ? "Saving…" : "Save") {
                        Task { await saveModal() }
                    }
                    .disabled(modalSaving || modalTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func createTask() async {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        creating = true
        defer { creating = false }
        do {
            _ = try app.tasksStore.create(title: title)
            newTitle = ""
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func toggleDone(_ task: TaskItem) {
        let status = TaskStatusPolicy.resolveStatus(for: task)
        if TaskStatusPolicy.taskIsDone(status) {
            patchStatus(task.id, status: TaskStatusPolicy.toggleTaskCompleted(status))
            return
        }
        if completingIds.contains(task.id) { return }

        if UIAccessibility.isReduceMotionEnabled {
            patchStatus(task.id, status: TaskStatusPolicy.toggleTaskCompleted(status))
            return
        }

        completingIds.insert(task.id)
        Task {
            try? await Task.sleep(for: .seconds(TaskCompleteTiming.ms))
            patchStatus(task.id, status: TaskStatusPolicy.toggleTaskCompleted(status))
            completingIds.remove(task.id)
        }
    }

    private func setStatus(_ id: String, status: TaskStatus) {
        patchStatus(id, status: status)
    }

    private func patchStatus(_ id: String, status: TaskStatus) {
        Task {
            do {
                _ = try app.tasksStore.update(id: id, status: status)
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private func deleteTask(_ id: String) {
        Task {
            do {
                _ = try app.tasksStore.delete(id: id)
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private func clearCompleted() {
        Task {
            do {
                _ = try app.tasksStore.clearCompleted()
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private func moveActiveTasks(from source: IndexSet, to destination: Int) {
        var ordered = activeTasks
        ordered.move(fromOffsets: source, toOffset: destination)
        Task {
            do {
                try app.tasksStore.reorderActive(taskIds: ordered.map(\.id))
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    private func openModal(_ task: TaskItem) {
        modalTask = task
        modalTitle = task.title
        modalStatus = TaskStatusPolicy.resolveStatus(for: task)
        modalTags = TagNormalization.normalizeTags(task.tags)
        tagInput = ""
    }

    private func addModalTagFromInput() {
        let next = TagNormalization.normalizeTags([tagInput])
        guard !next.isEmpty else {
            tagInput = ""
            return
        }
        modalTags = TagNormalization.normalizeTags(modalTags + next)
        tagInput = ""
    }

    @MainActor
    private func saveModal() async {
        guard let task = modalTask else { return }
        let trimmed = modalTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        modalSaving = true
        defer { modalSaving = false }
        do {
            _ = try app.tasksStore.update(id: task.id, title: trimmed, status: modalStatus, tags: modalTags)
            modalTask = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    @MainActor
    private func deleteFromModal() async {
        guard let task = modalTask else { return }
        modalSaving = true
        defer { modalSaving = false }
        do {
            _ = try app.tasksStore.delete(id: task.id)
            modalTask = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

private struct TaskTagChips: View {
    let tags: [String]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                Text(tag.replacingOccurrences(of: "_", with: " "))
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.quaternarySystemFill))
                    .clipShape(Capsule())
            }
        }
    }
}

private struct TaskTagEditor: View {
    @Binding var tags: [String]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                HStack(spacing: 4) {
                    Text(tag.replacingOccurrences(of: "_", with: " "))
                    Button {
                        tags.removeAll { $0 == tag }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption2.weight(.bold))
                    }
                    .buttonStyle(.plain)
                }
                .font(.caption)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(.quaternarySystemFill))
                .clipShape(Capsule())
            }
        }
    }
}

/// Simple horizontal wrapping layout for tag chips.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
    }
}

#Preview("Tasks") {
    PreviewNavigationRoot {
        TasksListView(app: PreviewSupport.populatedApp(withTasks: true))
    }
}
