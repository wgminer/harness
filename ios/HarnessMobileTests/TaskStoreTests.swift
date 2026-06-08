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
}
