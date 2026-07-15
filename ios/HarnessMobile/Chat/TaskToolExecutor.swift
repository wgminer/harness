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

    /// OpenAI schemas for `toolNames`, sourced from the shared `resources/contracts/tools.json`
    /// (see `SharedToolDefinitions`) rather than hand-copied — keeps iOS in sync with desktop.
    static var openAITools: [[String: Any]] {
        SharedToolDefinitions.filtered(names: toolNames)
    }
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
        case "web_search": return "Searched the web"
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
