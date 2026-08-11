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
        let expected = """
        {
          "a": {
            "createdAt": 1,
            "title": "A"
          },
          "b": {
            "createdAt": 2,
            "title": "B"
          }
        }
        """.data(using: .utf8)!
        XCTAssertEqual(merged, expected)
    }

    func testMergeMessagesDedupUsesSortedKeyStamps() throws {
        let local = Data(
            #"[{"id":"m1","role":"user","content":"hi","createdAt":1},{"id":"m2","role":"assistant","content":"dup","createdAt":2}]"#.utf8
        )
        let remote = Data(
            #"[{"role":"assistant","content":"dup","createdAt":2,"id":"m2"},{"id":"m3","role":"user","content":"new","createdAt":3}]"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(
            path: "app-state/messages_abc.json",
            local: local,
            remote: remote
        )
        let expected = """
        [
          {
            "content": "hi",
            "createdAt": 1,
            "id": "m1",
            "role": "user"
          },
          {
            "content": "dup",
            "createdAt": 2,
            "id": "m2",
            "role": "assistant"
          },
          {
            "content": "new",
            "createdAt": 3,
            "id": "m3",
            "role": "user"
          }
        ]
        """.data(using: .utf8)!
        XCTAssertEqual(merged, expected)
    }

    func testMergeTasksPrefersNewerUpdatedAt() throws {
        let local = Data(
            #"{"tasks":[{"id":"t1","title":"Local","updatedAt":20}]}"#.utf8
        )
        let remote = Data(
            #"{"tasks":[{"id":"t1","title":"Remote","updatedAt":10},{"id":"t2","title":"Only remote","updatedAt":5}]}"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(path: "app-state/tasks.json", local: local, remote: remote)
        let expected = """
        {
          "tasks": [
            {
              "id": "t1",
              "title": "Local",
              "updatedAt": 20
            },
            {
              "id": "t2",
              "title": "Only remote",
              "updatedAt": 5
            }
          ]
        }
        """.data(using: .utf8)!
        XCTAssertEqual(merged, expected)
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

    func testMergeSettingsPreservesLocalSyncAndStripsSecrets() throws {
        let local = Data(
            #"{"version":1,"sync":{"bucket":"phone"},"openai":{"apiKey":"local-key"}}"#.utf8
        )
        let remote = Data(
            #"{"version":2,"sync":{"bucket":"desktop"},"openai":{"apiKey":"remote-key"},"search":{"tavilyApiKey":"tvly"}}"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(
            path: "settings/settings.json",
            local: local,
            remote: remote
        )
        let parsed = try JSONSerialization.jsonObject(with: merged) as? [String: Any]
        let sync = parsed?["sync"] as? [String: Any]
        XCTAssertEqual(sync?["bucket"] as? String, "phone")
        let openai = parsed?["openai"] as? [String: Any]
        let search = parsed?["search"] as? [String: Any]
        XCTAssertNil(openai?["apiKey"])
        XCTAssertNil(search?["tavilyApiKey"])
    }

    func testMergeNotesByIdPrefersNewer() throws {
        let local = Data(
            #"{"notes":[{"id":"n1","title":"Local","updatedAt":20}]}"#.utf8
        )
        let remote = Data(
            #"{"notes":[{"id":"n1","title":"Remote","updatedAt":10},{"id":"n2","title":"Only remote","updatedAt":5}]}"#.utf8
        )
        let merged = SyncMerge.mergeFileBytes(path: "app-state/notes.json", local: local, remote: remote)
        let expected = """
        {
          "notes": [
            {
              "id": "n1",
              "title": "Local",
              "updatedAt": 20
            },
            {
              "id": "n2",
              "title": "Only remote",
              "updatedAt": 5
            }
          ]
        }
        """.data(using: .utf8)!
        XCTAssertEqual(merged, expected)
    }

    func testImageLibraryMergesPerRecordAndKeepsBlobs() throws {
        let localIndex = Data(
            #"{"images":[{"id":"local-img","title":"Local","prompt":"x","createdAt":1,"updatedAt":200,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"local-img.png"}]}"#.utf8
        )
        let remoteIndex = Data(
            #"{"images":[{"id":"remote-img","title":"Remote","prompt":"y","createdAt":1,"updatedAt":100,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"remote-img.png"}]}"#.utf8
        )
        let local: [String: Data] = [
            "app-state/images.json": localIndex,
            "app-state/images/local-img.png": Data("local-bytes".utf8),
        ]
        let remote: [String: Data] = [
            "app-state/images.json": remoteIndex,
            "app-state/images/remote-img.png": Data("remote-bytes".utf8),
        ]
        let review = SyncMerge.buildConflictReview(localFiles: local, remoteFiles: remote)
        let choices = SyncMerge.buildDefaultMergeChoices(
            review: review,
            localFiles: local,
            remoteFiles: remote
        )
        let merged = SyncMerge.buildMergedFileMap(
            localFiles: local,
            remoteFiles: remote,
            choices: choices
        )
        let parsed = try JSONSerialization.jsonObject(with: merged["app-state/images.json"]!) as? [String: Any]
        let images = parsed?["images"] as? [[String: Any]] ?? []
        let ids = Set(images.compactMap { $0["id"] as? String })
        XCTAssertEqual(ids, Set(["local-img", "remote-img"]))
        XCTAssertEqual(merged["app-state/images/local-img.png"], Data("local-bytes".utf8))
        XCTAssertEqual(merged["app-state/images/remote-img.png"], Data("remote-bytes".utf8))
    }
}
