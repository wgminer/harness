import Foundation

enum TaskToolDefinitions {
    static let toolNames: Set<String> = [
        "task_list",
        "task_create",
        "task_update",
        "task_delete",
        "task_clear_completed",
    ]

    static let gatedToolNames: Set<String> = [
        "task_delete",
        "task_clear_completed",
        "task_update",
    ]

    static let openAITools: [[String: Any]] = [
        [
            "type": "function",
            "function": [
                "name": "task_list",
                "description": "List all persistent assistant tasks. Use this to understand current open work items before adding or changing tasks.",
                "parameters": ["type": "object", "properties": [:] as [String: Any]],
            ] as [String: Any],
        ],
        [
            "type": "function",
            "function": [
                "name": "task_create",
                "description": "Create a new persistent assistant task that will be remembered across messages. Use concise, user-facing titles.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "title": ["type": "string", "description": "Short description of the task"],
                        "status": [
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed", "cancelled"],
                            "description": "Workflow state for the task. Defaults to pending.",
                        ],
                        "tags": [
                            "type": "array",
                            "items": ["type": "string"],
                            "description": "Optional filterable labels (e.g. urgent, research).",
                        ],
                        "metadata": [
                            "type": "object",
                            "description": "Optional extra structured information about the task.",
                        ],
                    ] as [String: Any],
                    "required": ["title"],
                ] as [String: Any],
            ] as [String: Any],
        ],
        [
            "type": "function",
            "function": [
                "name": "task_update",
                "description": "Update an existing persistent assistant task (rename, change status, edit filterable tags, or attach metadata).",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "id": ["type": "string", "description": "ID of the task to update"],
                        "title": ["type": "string", "description": "New title, if you want to rename the task"],
                        "status": [
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed", "cancelled"],
                        ],
                        "tags": ["type": "array", "items": ["type": "string"]],
                        "add_tags": ["type": "array", "items": ["type": "string"]],
                        "remove_tags": ["type": "array", "items": ["type": "string"]],
                        "metadata": ["type": "object"],
                    ] as [String: Any],
                    "required": ["id"],
                ] as [String: Any],
            ] as [String: Any],
        ],
        [
            "type": "function",
            "function": [
                "name": "task_delete",
                "description": "Delete a persistent assistant task by ID when it is no longer relevant.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "id": ["type": "string", "description": "ID of the task to delete"],
                    ] as [String: Any],
                    "required": ["id"],
                ] as [String: Any],
            ] as [String: Any],
        ],
        [
            "type": "function",
            "function": [
                "name": "task_clear_completed",
                "description": "Remove all tasks whose status is completed or cancelled to keep the task list tidy.",
                "parameters": ["type": "object", "properties": [:] as [String: Any]],
            ] as [String: Any],
        ],
    ]
}

enum GatedToolAction: Equatable {
    case proceed
    case cancel
}

struct PendingGatedTool: Equatable, Identifiable {
    let id: String
    let toolName: String
    let args: [String: Any]

    static func == (lhs: PendingGatedTool, rhs: PendingGatedTool) -> Bool {
        lhs.id == rhs.id && lhs.toolName == rhs.toolName
    }
}

@MainActor
final class GatedToolCoordinator: ObservableObject {
    @Published private(set) var pending: PendingGatedTool?
    private var continuation: CheckedContinuation<GatedToolAction, Never>?

    func request(toolName: String, args: [String: Any]) async -> GatedToolAction {
        if continuation != nil {
            return .cancel
        }
        let pendingId = UUID().uuidString
        pending = PendingGatedTool(id: pendingId, toolName: toolName, args: args)
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resolve(_ action: GatedToolAction) {
        pending = nil
        continuation?.resume(returning: action)
        continuation = nil
    }

    func cancelPending() {
        resolve(.cancel)
    }
}

@MainActor
final class TaskToolExecutor {
    private let tasksStore: TasksStore
    private let gatedToolCoordinator: GatedToolCoordinator

    init(tasksStore: TasksStore, gatedToolCoordinator: GatedToolCoordinator) {
        self.tasksStore = tasksStore
        self.gatedToolCoordinator = gatedToolCoordinator
    }

    func execute(name: String, args: [String: Any]) async throws -> String {
        guard TaskToolDefinitions.toolNames.contains(name) else {
            return encodeJSON(["error": "Unknown task tool: \(name)"])
        }

        if TaskToolDefinitions.gatedToolNames.contains(name) {
            let action = await gatedToolCoordinator.request(toolName: name, args: args)
            if action == .cancel {
                return encodeJSON(["cancelled": true, "message": "User cancelled the action."])
            }
        }

        let payload = try tasksStore.executeTool(name: name, args: args)
        return encodeTasksPayload(payload)
    }

    private func encodeTasksPayload(_ payload: TasksPayload) -> String {
        var object: [String: Any] = [
            "tasks": payload.tasks.map { taskDictionary($0) },
            "lastAction": payload.lastAction.rawValue,
        ]
        if let affectedIds = payload.affectedIds {
            object["affectedIds"] = affectedIds
        }
        if let error = payload.error {
            object["error"] = error
        }
        return encodeJSON(object)
    }

    private func taskDictionary(_ task: TaskItem) -> [String: Any] {
        var dict: [String: Any] = [
            "id": task.id,
            "title": task.title,
            "status": task.status.rawValue,
            "tags": task.tags,
            "createdAt": task.createdAt,
            "updatedAt": task.updatedAt,
        ]
        if let metadata = task.metadata {
            dict["metadata"] = metadata.mapValues { $0.any }
        }
        return dict
    }

    private func encodeJSON(_ object: [String: Any]) -> String {
        ToolResultJSON.encode(object)
    }
}

enum ToolCallLabels {
    static let compressThreshold = 2

    static func label(for toolName: String) -> String {
        switch toolName {
        case "task_list": return "Reviewed tasks"
        case "task_create": return "Created task"
        case "task_update": return "Updated task"
        case "task_delete": return "Deleted task"
        case "task_clear_completed": return "Cleared completed"
        case "memory_set_fact": return "Updated context"
        case "memory_list_facts": return "Listed context"
        case "memory_search_conversations": return "Searched history"
        case "get_datetime": return "Checked date & time"
        case "note_list": return "Listed notes"
        case "note_create": return "Created note"
        case "note_read": return "Read note"
        case "note_save": return "Saved note"
        case "note_delete": return "Deleted note"
        case "set_layout": return "Updated layout"
        default:
            return fallbackLabel(for: toolName)
        }
    }

    /// Mirrors `toolLabel` fallback in `src/renderer/chatHelpers.tsx` (first char only).
    private static func fallbackLabel(for toolName: String) -> String {
        let spaced = toolName.replacingOccurrences(of: "_", with: " ")
        guard let first = spaced.first else { return spaced }
        return String(first).uppercased() + spaced.dropFirst()
    }

    static func summarize(_ toolCalls: [ToolCallRecord]) -> String {
        guard !toolCalls.isEmpty else { return "" }
        var counts: [String: Int] = [:]
        for call in toolCalls {
            counts[call.toolName, default: 0] += 1
        }
        let parts = counts.map { name, count in
            count > 1 ? "\(label(for: name)) (\(count))" : label(for: name)
        }
        if parts.count <= 4 {
            return parts.joined(separator: ", ")
        }
        return "\(toolCalls.count) actions"
    }
}
