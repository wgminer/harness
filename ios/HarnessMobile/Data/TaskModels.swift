import Foundation

enum TaskStatus: String, Codable, CaseIterable {
    case pending
    case in_progress
    case completed
    case cancelled

    static let workflowTags: Set<String> = Set(TaskStatus.allCases.map(\.rawValue))
}

struct TaskItem: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var status: TaskStatus
    var tags: [String]
    let createdAt: Int64
    var updatedAt: Int64
    var metadata: [String: JSONValue]?
}

struct TaskState: Equatable {
    var tasks: [TaskItem]
}

struct TasksPayload: Equatable {
    var tasks: [TaskItem]
    var lastAction: TaskActionKind
    var affectedIds: [String]?
    var error: String?

    init(
        tasks: [TaskItem],
        lastAction: TaskActionKind,
        affectedIds: [String]? = nil,
        error: String? = nil
    ) {
        self.tasks = tasks
        self.lastAction = lastAction
        self.affectedIds = affectedIds
        self.error = error
    }
}

enum TaskActionKind: String, Equatable {
    case list
    case create
    case update
    case delete
    case clear_completed
}

enum TaskOrdering {
    private static let sortIndexKey = "sortIndex"

    static func sortIndex(for task: TaskItem) -> Double? {
        guard let metadata = task.metadata,
              case .number(let value) = metadata[sortIndexKey]
        else { return nil }
        return value
    }

    static func sorted(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.sorted { lhs, rhs in
            let left = sortIndex(for: lhs)
            let right = sortIndex(for: rhs)
            switch (left, right) {
            case let (l?, r?):
                return l < r
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            case (nil, nil):
                return lhs.createdAt > rhs.createdAt
            }
        }
    }

    static func statusLabel(_ status: TaskStatus) -> String {
        switch status {
        case .pending: return "To do"
        case .in_progress: return "In progress"
        case .completed: return "Done"
        case .cancelled: return "Cancelled"
        }
    }
}

enum TaskStatusPolicy {
    private static let statusPriority: [TaskStatus] = [.completed, .cancelled, .in_progress, .pending]

    static func normalizeStatus(_ input: Any?) -> TaskStatus? {
        guard let raw = input as? String else { return nil }
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: "_", options: .regularExpression)
        return TaskStatus(rawValue: normalized)
    }

    static func migrateTaskFields(record: [String: Any]) -> (status: TaskStatus, tags: [String]) {
        let rawTags = TagNormalization.normalizeTags(record["tags"])
        let statusTags = rawTags.filter { TaskStatus.workflowTags.contains($0) }
        let labelTags = rawTags.filter { !TaskStatus.workflowTags.contains($0) }

        let fromField = normalizeStatus(record["status"])
        let fromTags = statusFromTagList(statusTags)
        let status = fromTags ?? fromField ?? .pending
        return (status, labelTags)
    }

    static func resolveStatus(for task: TaskItem) -> TaskStatus {
        let rawTags = TagNormalization.normalizeTags(task.tags)
        if TaskStatus(rawValue: task.status.rawValue) != nil,
           !rawTags.contains(where: { TaskStatus.workflowTags.contains($0) }) {
            return task.status
        }
        return migrateTaskFields(record: [
            "status": task.status.rawValue,
            "tags": task.tags,
        ]).status
    }

    static func taskIsActive(_ status: TaskStatus) -> Bool {
        status == .pending || status == .in_progress
    }

    static func taskIsInCompletedSection(_ status: TaskStatus) -> Bool {
        taskIsClearable(status)
    }

    static func taskIsDone(_ status: TaskStatus) -> Bool {
        status == .completed
    }

    static func taskIsClearable(_ status: TaskStatus) -> Bool {
        status == .completed || status == .cancelled
    }

    static func toggleTaskCompleted(_ status: TaskStatus) -> TaskStatus {
        status == .completed ? .pending : .completed
    }

    static func taskNeedsStatusMigration(record: [String: Any]) -> Bool {
        if normalizeStatus(record["status"]) == nil { return true }
        return TagNormalization.normalizeTags(record["tags"]).contains { TaskStatus.workflowTags.contains($0) }
    }

    private static func statusFromTagList(_ tags: [String]) -> TaskStatus? {
        for status in statusPriority where tags.contains(status.rawValue) {
            return status
        }
        return nil
    }
}

/// Lightweight Codable wrapper for arbitrary JSON objects in task metadata and tool payloads.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from any: Any) {
        switch any {
        case let value as String:
            self = .string(value)
        case let value as NSNumber where CFGetTypeID(value) == CFBooleanGetTypeID():
            self = .bool(value.boolValue)
        case let value as NSNumber:
            self = .number(value.doubleValue)
        case let value as [String: Any]:
            self = .object(value.mapValues { JSONValue(from: $0) })
        case let value as [Any]:
            self = .array(value.map { JSONValue(from: $0) })
        default:
            self = .null
        }
    }

    var any: Any {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            return value
        case .bool(let value):
            return value
        case .object(let value):
            return value.mapValues { $0.any }
        case .array(let value):
            return value.map { $0.any }
        case .null:
            return NSNull()
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

struct ToolCallRecord: Codable, Equatable, Identifiable {
    var id: String { toolName + "-" + (payloadFingerprint ?? "") }
    let toolName: String
    let payload: JSONValue?

    private var payloadFingerprint: String? {
        guard let payload else { return nil }
        let data = try? JSONEncoder().encode(payload)
        return data.flatMap { String(data: $0, encoding: .utf8) }
    }

    init(toolName: String, payload: Any?) {
        self.toolName = toolName
        if let payload {
            self.payload = JSONValue(from: payload)
        } else {
            self.payload = nil
        }
    }

    var payloadDictionary: [String: Any]? {
        guard case .object(let object)? = payload else { return nil }
        return object.mapValues { $0.any }
    }

    var isPending: Bool {
        payloadDictionary?["pending"] as? Bool == true
    }
}
