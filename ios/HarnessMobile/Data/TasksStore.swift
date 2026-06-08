import Foundation

@MainActor
final class TasksStore: ObservableObject {
    @Published private(set) var tasks: [TaskItem] = []

    let localDataDir: URL

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
    }

    func reload() throws {
        tasks = try Self.loadTasks(in: localDataDir).tasks
    }

    func list() throws -> TasksPayload {
        let state = try Self.loadTasks(in: localDataDir)
        return TasksPayload(tasks: state.tasks, lastAction: .list)
    }

    @discardableResult
    func create(title: String, tags: [String] = [], status: TaskStatus = .pending) throws -> TasksPayload {
        let payload = Self.applyTaskAction(
            state: try Self.loadTasks(in: localDataDir),
            action: .create(args: ["title": title, "tags": tags, "status": status.rawValue])
        )
        if payload.error == nil {
            try Self.saveTasks(payload.tasks, in: localDataDir)
            tasks = payload.tasks
        }
        return payload
    }

    @discardableResult
    func update(id: String, title: String? = nil, status: TaskStatus? = nil, tags: [String]? = nil) throws -> TasksPayload {
        var args: [String: Any] = ["id": id]
        if let title { args["title"] = title }
        if let status { args["status"] = status.rawValue }
        if let tags { args["tags"] = tags }
        let payload = Self.applyTaskAction(
            state: try Self.loadTasks(in: localDataDir),
            action: .update(args: args)
        )
        if payload.error == nil {
            try Self.saveTasks(payload.tasks, in: localDataDir)
            tasks = payload.tasks
        }
        return payload
    }

    @discardableResult
    func delete(id: String) throws -> TasksPayload {
        let payload = Self.applyTaskAction(
            state: try Self.loadTasks(in: localDataDir),
            action: .delete(args: ["id": id])
        )
        if payload.error == nil {
            try Self.saveTasks(payload.tasks, in: localDataDir)
            tasks = payload.tasks
        }
        return payload
    }

    @discardableResult
    func clearCompleted() throws -> TasksPayload {
        let payload = Self.applyTaskAction(
            state: try Self.loadTasks(in: localDataDir),
            action: .clearCompleted
        )
        try Self.saveTasks(payload.tasks, in: localDataDir)
        tasks = payload.tasks
        return payload
    }

    func executeTool(name: String, args: [String: Any]) throws -> TasksPayload {
        let action: TaskReducerAction
        switch name {
        case "task_list":
            action = .list
        case "task_create":
            action = .create(args: args)
        case "task_update":
            action = .update(args: args)
        case "task_delete":
            action = .delete(args: args)
        case "task_clear_completed":
            action = .clearCompleted
        default:
            return TasksPayload(tasks: tasks, lastAction: .list, error: "Unknown task tool: \(name)")
        }

        let payload = Self.applyTaskAction(state: try Self.loadTasks(in: localDataDir), action: action)
        if payload.error == nil, name != "task_list" {
            try Self.saveTasks(payload.tasks, in: localDataDir)
            tasks = payload.tasks
        } else if payload.error == nil {
            tasks = payload.tasks
        }
        return payload
    }

    // MARK: - Reducer (mirrors `src/main/assistantTools.ts`)

    private enum TaskReducerAction {
        case list
        case create(args: [String: Any])
        case update(args: [String: Any])
        case delete(args: [String: Any])
        case clearCompleted
    }

    private static func applyTaskAction(
        state: TaskState,
        action: TaskReducerAction,
        nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> TasksPayload {
        applyTaskAction(
            state: state,
            action: action,
            nowMs: nowMs,
            idFactory: { generateId(prefix: "task") }
        )
    }

    private static func applyTaskAction(
        state: TaskState,
        action: TaskReducerAction,
        nowMs: Int64,
        idFactory: () -> String
    ) -> TasksPayload {
        var nextTasks = state.tasks

        switch action {
        case .list:
            return TasksPayload(tasks: nextTasks, lastAction: .list)

        case .create(let args):
            let title = String(describing: args["title"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else {
                return TasksPayload(tasks: nextTasks, lastAction: .create, error: "Task title is required")
            }
            let status = TaskStatusPolicy.normalizeStatus(args["status"]) ?? .pending
            let tags = TagNormalization.normalizeTags(args["tags"])
            var metadata: [String: JSONValue]?
            if let raw = args["metadata"] as? [String: Any] {
                metadata = raw.mapValues { JSONValue(from: $0) }
            }
            let task = TaskItem(
                id: idFactory(),
                title: title,
                status: status,
                tags: tags,
                createdAt: nowMs,
                updatedAt: nowMs,
                metadata: metadata
            )
            nextTasks.append(task)
            return TasksPayload(tasks: nextTasks, lastAction: .create, affectedIds: [task.id])

        case .update(let args):
            let id = String(describing: args["id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty else {
                return TasksPayload(tasks: nextTasks, lastAction: .update, error: "Task id is required")
            }
            guard let index = nextTasks.firstIndex(where: { $0.id == id }) else {
                return TasksPayload(tasks: nextTasks, lastAction: .update, error: "Task not found: \(id)")
            }
            var existing = nextTasks[index]
            existing.updatedAt = nowMs
            if let title = args["title"] as? String {
                let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { existing.title = trimmed }
            }
            if let statusRaw = args["status"] as? String, let status = TaskStatusPolicy.normalizeStatus(statusRaw) {
                existing.status = status
            }
            if let tagPatch = TagNormalization.applyTagPatch(existing: existing.tags, patch: args) {
                existing.tags = tagPatch
            }
            if let raw = args["metadata"] as? [String: Any] {
                var merged = existing.metadata ?? [:]
                for (key, value) in raw {
                    merged[key] = JSONValue(from: value)
                }
                existing.metadata = merged
            }
            nextTasks[index] = existing
            return TasksPayload(tasks: nextTasks, lastAction: .update, affectedIds: [id])

        case .delete(let args):
            let id = String(describing: args["id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty else {
                return TasksPayload(tasks: nextTasks, lastAction: .delete, error: "Task id is required")
            }
            let before = nextTasks.count
            nextTasks.removeAll { $0.id == id }
            guard nextTasks.count < before else {
                return TasksPayload(tasks: nextTasks, lastAction: .delete, error: "Task not found: \(id)")
            }
            return TasksPayload(tasks: nextTasks, lastAction: .delete, affectedIds: [id])

        case .clearCompleted:
            var remaining: [TaskItem] = []
            var removedIds: [String] = []
            for task in nextTasks {
                if TaskStatusPolicy.taskIsClearable(task.status) {
                    removedIds.append(task.id)
                } else {
                    remaining.append(task)
                }
            }
            nextTasks = remaining
            return TasksPayload(tasks: nextTasks, lastAction: .clear_completed, affectedIds: removedIds)
        }
    }

    static func loadTasks(in localDataDir: URL) throws -> TaskState {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.tasksFile)
        guard FileManager.default.fileExists(atPath: path.path) else {
            return TaskState(tasks: [])
        }
        let data = try Data(contentsOf: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return TaskState(tasks: [])
        }
        let rows: [[String: Any]]
        if let taskRows = json["tasks"] as? [[String: Any]] {
            rows = taskRows
        } else {
            rows = []
        }

        var needsRewrite = false
        var tasks: [TaskItem] = []
        for row in rows {
            guard let task = migrateRawTask(row) else { continue }
            tasks.append(task)
            if TaskStatusPolicy.taskNeedsStatusMigration(record: row) {
                needsRewrite = true
            }
        }
        if needsRewrite, !tasks.isEmpty {
            try saveTasks(tasks, in: localDataDir)
        }
        return TaskState(tasks: tasks)
    }

    static func saveTasks(_ tasks: [TaskItem], in localDataDir: URL) throws {
        try LocalDataLayout.ensureDirectories(at: localDataDir)
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.tasksFile)
        let envelope = TasksEnvelope(tasks: tasks)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(envelope)
        try data.write(to: path, options: .atomic)
    }

    private static func migrateRawTask(_ raw: [String: Any]) -> TaskItem? {
        let id = String(describing: raw["id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title = String(describing: raw["title"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !title.isEmpty else { return nil }

        let createdAt = parseTimestamp(raw["createdAt"]) ?? Int64(Date().timeIntervalSince1970 * 1000)
        let updatedAt = parseTimestamp(raw["updatedAt"]) ?? createdAt
        let migrated = TaskStatusPolicy.migrateTaskFields(record: raw)
        var metadata: [String: JSONValue]?
        if let rawMeta = raw["metadata"] as? [String: Any] {
            metadata = rawMeta.mapValues { JSONValue(from: $0) }
        }
        return TaskItem(
            id: id,
            title: title,
            status: migrated.status,
            tags: migrated.tags,
            createdAt: createdAt,
            updatedAt: updatedAt,
            metadata: metadata
        )
    }

    private static func parseTimestamp(_ value: Any?) -> Int64? {
        switch value {
        case let n as Int64: return n
        case let n as Int: return Int64(n)
        case let n as Double where n.isFinite: return Int64(n)
        case let n as NSNumber: return n.int64Value
        default: return nil
        }
    }

    private static func generateId(prefix: String) -> String {
        let suffix = String(UUID().uuidString.prefix(8).lowercased())
        return "\(prefix)_\(Int64(Date().timeIntervalSince1970 * 1000))_\(suffix)"
    }
}

private struct TasksEnvelope: Encodable {
    let tasks: [TaskItem]
}
