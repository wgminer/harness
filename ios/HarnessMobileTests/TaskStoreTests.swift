import XCTest
@testable import HarnessMobile

final class TaskStoreTests: XCTestCase {
    private var tempDir: URL!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        try LocalDataLayout.ensureDirectories(at: tempDir)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDir)
        tempDir = nil
    }

    @MainActor
    func testCreatesUpdatesAndDeletesTasks() throws {
        let store = TasksStore(localDataDir: tempDir)
        let created = try store.create(title: "Write tests")
        XCTAssertNil(created.error)
        XCTAssertEqual(created.tasks.first?.status, .pending)

        let taskId = try XCTUnwrap(created.tasks.first?.id)
        let updated = try store.update(id: taskId, status: .completed, tags: ["ci"])
        XCTAssertEqual(updated.tasks.first?.status, .completed)
        XCTAssertEqual(updated.tasks.first?.tags, ["ci"])

        let deleted = try store.delete(id: taskId)
        XCTAssertTrue(deleted.tasks.isEmpty)
    }

    @MainActor
    func testMigratesLegacyStatusInTagsWhenLoading() throws {
        let raw: [String: Any] = [
            "tasks": [[
                "id": "x",
                "title": "Legacy",
                "tags": ["pending", "work"],
                "createdAt": 1,
                "updatedAt": 1,
            ]],
        ]
        let path = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.tasksFile)
        let data = try JSONSerialization.data(withJSONObject: raw)
        try data.write(to: path)

        let loaded = try TasksStore.loadTasks(in: tempDir)
        XCTAssertEqual(loaded.tasks.count, 1)
        XCTAssertEqual(loaded.tasks[0].status, .pending)
        XCTAssertEqual(loaded.tasks[0].tags, ["work"])
    }

    @MainActor
    func testClearCompletedPreservesActiveTasks() throws {
        let store = TasksStore(localDataDir: tempDir)
        _ = try store.create(title: "Done", status: .completed)
        _ = try store.create(title: "In progress", status: .in_progress)
        _ = try store.create(title: "Cancelled", status: .cancelled)

        let cleared = try store.clearCompleted()
        XCTAssertEqual(cleared.tasks.count, 1)
        XCTAssertEqual(cleared.tasks.first?.status, .in_progress)
        XCTAssertEqual(cleared.tasks.first?.title, "In progress")
    }

    @MainActor
    func testReorderActivePersistsSortIndexMetadata() throws {
        let store = TasksStore(localDataDir: tempDir)
        let firstId = try XCTUnwrap(try store.create(title: "First").affectedIds?.first)
        let secondId = try XCTUnwrap(try store.create(title: "Second").affectedIds?.first)
        let thirdId = try XCTUnwrap(try store.create(title: "Third").affectedIds?.first)
        let ids = [thirdId, firstId, secondId]

        try store.reorderActive(taskIds: ids)
        try store.reload()

        let ordered = TaskOrdering.sorted(store.tasks.filter { TaskStatusPolicy.taskIsActive($0.status) })
        XCTAssertEqual(ordered.map(\.title), ["Third", "First", "Second"])
        XCTAssertEqual(TaskOrdering.sortIndex(for: ordered[0]), 0)
        XCTAssertEqual(TaskOrdering.sortIndex(for: ordered[1]), 1)
        XCTAssertEqual(TaskOrdering.sortIndex(for: ordered[2]), 2)
    }

    @MainActor
    func testTaskToolsNestSubtasksOneLevel() throws {
        let store = TasksStore(localDataDir: tempDir)
        let parentId = try XCTUnwrap(store.executeTool(name: "task_create", args: ["title": "Parent"]).affectedIds?.first)
        let child = try store.executeTool(name: "task_create", args: ["title": "Child", "parentId": parentId])
        let childId = try XCTUnwrap(child.affectedIds?.first)
        XCTAssertEqual(child.tasks.first { $0.id == childId }?.parentId, parentId)

        let grandchild = try store.executeTool(name: "task_create", args: ["title": "Grandchild", "parentId": childId])
        XCTAssertNotNil(grandchild.error)
        let nestParent = try store.executeTool(name: "task_update", args: ["id": parentId, "parentId": childId])
        XCTAssertNotNil(nestParent.error)

        let promoted = try store.executeTool(name: "task_update", args: ["id": childId, "parentId": NSNull()])
        XCTAssertNil(promoted.error)
        XCTAssertNil(promoted.tasks.first { $0.id == childId }?.parentId)
    }

    @MainActor
    func testTaskToolsSetAndClearMatrixFields() throws {
        let store = TasksStore(localDataDir: tempDir)
        let created = try store.executeTool(
            name: "task_create",
            args: ["title": "Taxes", "important": true, "dueDate": "2026-04-15", "estimateMinutes": 90]
        )
        let id = try XCTUnwrap(created.affectedIds?.first)
        let task = try XCTUnwrap(created.tasks.first { $0.id == id })
        XCTAssertEqual(task.important, true)
        XCTAssertEqual(task.dueDate, "2026-04-15")
        XCTAssertEqual(task.estimateMinutes, 90)

        // Survives a reload from disk.
        let reloaded = try TasksStore.loadTasks(in: tempDir).tasks.first { $0.id == id }
        XCTAssertEqual(reloaded, task)

        let renamed = try store.executeTool(name: "task_update", args: ["id": id, "title": "File taxes"])
        XCTAssertEqual(renamed.tasks.first { $0.id == id }?.dueDate, "2026-04-15")

        let cleared = try store.executeTool(
            name: "task_update",
            args: ["id": id, "important": false, "dueDate": NSNull(), "estimateMinutes": 0]
        )
        let after = try XCTUnwrap(cleared.tasks.first { $0.id == id })
        XCTAssertNil(after.important)
        XCTAssertNil(after.dueDate)
        XCTAssertNil(after.estimateMinutes)
    }

    @MainActor
    func testTaskToolsRejectDueDatesThatAreNotCalendarDays() throws {
        let store = TasksStore(localDataDir: tempDir)
        for bad in ["tomorrow", "2026-02-30", "04/15/2026"] {
            let payload = try store.executeTool(name: "task_create", args: ["title": "T", "dueDate": bad])
            XCTAssertNotNil(payload.error, bad)
        }
    }

    @MainActor
    func testDeletingParentDeletesSubtasks() throws {
        let store = TasksStore(localDataDir: tempDir)
        let parentId = try XCTUnwrap(store.executeTool(name: "task_create", args: ["title": "Parent"]).affectedIds?.first)
        _ = try store.executeTool(name: "task_create", args: ["title": "Child", "parentId": parentId])
        _ = try store.executeTool(name: "task_create", args: ["title": "Other"])

        let deleted = try store.delete(id: parentId)
        XCTAssertEqual(deleted.tasks.map(\.title), ["Other"])
    }

    @MainActor
    func testClearCompletedPromotesOpenSubtasks() throws {
        let store = TasksStore(localDataDir: tempDir)
        let parentId = try XCTUnwrap(store.executeTool(name: "task_create", args: ["title": "Parent"]).affectedIds?.first)
        _ = try store.executeTool(name: "task_create", args: ["title": "Child", "parentId": parentId])
        _ = try store.update(id: parentId, status: .completed)

        let cleared = try store.executeTool(name: "task_clear_completed", args: [:])
        XCTAssertEqual(cleared.tasks.map(\.title), ["Child"])
        XCTAssertNil(cleared.tasks.first?.parentId)
    }
}
