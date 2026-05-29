import XCTest
@testable import HarnessMobile

final class SyncMergeTests: XCTestCase {
    func testBuildConflictReviewClassifiesFiles() {
        let local: [String: Data] = [
            "app-state/a.json": Data(#"{"local":1}"#.utf8),
            "app-state/shared.json": Data(#"{"same":true}"#.utf8),
            "app-state/conflict.json": Data(#"{"from":"local"}"#.utf8),
        ]
        let remote: [String: Data] = [
            "app-state/shared.json": Data(#"{"same":true}"#.utf8),
            "app-state/b.json": Data(#"{"remote":1}"#.utf8),
            "app-state/conflict.json": Data(#"{"from":"remote"}"#.utf8),
        ]

        let review = SyncMerge.buildConflictReview(localFiles: local, remoteFiles: remote)
        XCTAssertEqual(review.summary.unchanged, 1)
        XCTAssertEqual(review.summary.localOnly, 1)
        XCTAssertEqual(review.summary.remoteOnly, 1)
        XCTAssertEqual(review.summary.conflict, 1)
    }

    func testMergeConversationsById() throws {
        let local = Data(#"{"a":{"title":"A","createdAt":1}}"#.utf8)
        let remote = Data(#"{"b":{"title":"B","createdAt":2}}"#.utf8)
        let merged = SyncMerge.mergeFileBytes(
            path: "app-state/conversations.json",
            local: local,
            remote: remote
        )
        let object = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        XCTAssertNotNil(object?["a"])
        XCTAssertNotNil(object?["b"])
    }

    func testMergeTasksPrefersNewerUpdatedAt() throws {
        let local = Data(
            #"{"tasks":[{"id":"t1","title":"Local","updatedAt":20}]}"#.utf8
        )
        let remote = Data(
            #"{"tasks":[{"id":"t1","title":"Remote","updatedAt":10},{"id":"t2","title":"Only remote","updatedAt":5}]}"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(path: "app-state/tasks.json", local: local, remote: remote)
        let parsed = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        let tasks = parsed?["tasks"] as? [[String: Any]] ?? []
        let byId = Dictionary(uniqueKeysWithValues: tasks.compactMap { row -> (String, String)? in
            guard let id = row["id"] as? String, let title = row["title"] as? String else { return nil }
            return (id, title)
        })
        XCTAssertEqual(byId["t1"], "Local")
        XCTAssertEqual(byId["t2"], "Only remote")
    }

    func testMergeUserMemoryDoesNotCrashOnPrimitiveValues() throws {
        // Regression: jsonEqual used to call JSONSerialization.data(withJSONObject:)
        // directly on primitive values, which raises an NSException ("Invalid
        // top-level type in JSON write") that `try?` cannot catch.
        let local = Data(#"{"identity":"loves cats","mood":"calm"}"#.utf8)
        let remote = Data(#"{"identity":"loves dogs","mood":"calm"}"#.utf8)
        let merged = SyncMerge.mergeFileBytes(
            path: "app-state/user_memory.json",
            local: local,
            remote: remote
        )
        let parsed = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        XCTAssertEqual(parsed?["mood"] as? String, "calm")
        XCTAssertNotNil(parsed?["identity"])
    }

    func testMergeSettingsDoesNotCrashOnPrimitiveValues() throws {
        // Regression: settings.json carries primitive top-level values such as
        // version numbers and boolean flags. jsonEqual must tolerate them.
        let local = Data(#"{"version":1,"openai":{"apiKey":"local"},"telemetry":true}"#.utf8)
        let remote = Data(#"{"version":2,"openai":{"apiKey":"remote"},"telemetry":false}"#.utf8)
        let merged = SyncMerge.mergeFileBytes(
            path: "settings/settings.json",
            local: local,
            remote: remote
        )
        let parsed = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        XCTAssertNotNil(parsed)
    }

    func testMergeClippingsPrefersNewerUpdatedAt() throws {
        let local = Data(
            #"{"clippings":[{"id":"c1","content":"Local","updatedAt":20}]}"#.utf8
        )
        let remote = Data(
            #"{"clippings":[{"id":"c1","content":"Remote","updatedAt":10},{"id":"c2","content":"Only remote","updatedAt":5}]}"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(path: "app-state/clippings.json", local: local, remote: remote)
        let parsed = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        let clippings = parsed?["clippings"] as? [[String: Any]] ?? []
        let byId = Dictionary(uniqueKeysWithValues: clippings.compactMap { row -> (String, String)? in
            guard let id = row["id"] as? String, let content = row["content"] as? String else { return nil }
            return (id, content)
        })
        XCTAssertEqual(byId["c1"], "Local")
        XCTAssertEqual(byId["c2"], "Only remote")
    }
}
