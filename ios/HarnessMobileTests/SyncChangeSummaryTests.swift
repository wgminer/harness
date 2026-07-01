import XCTest
@testable import HarnessMobile

final class SyncChangeSummaryTests: XCTestCase {
    func testDescribeNoopWithConversations() {
        let detail = SyncChangeSummary.describeNoop(hasLocalEdits: false, conversationCount: 3)
        XCTAssertEqual(detail, "Up to date with R2. 3 conversations.")
    }

    func testDescribeNoopWithLocalEdits() {
        let detail = SyncChangeSummary.describeNoop(hasLocalEdits: true, conversationCount: 1)
        XCTAssertEqual(detail, "Everything matches remote backup, but this phone still has changes waiting to upload.")
    }

    func testDescribeConversationChangesAddedAndUpdated() {
        let before: [String: ConversationSnapshot] = [
            "a": ConversationSnapshot(id: "a", title: "Old title", createdAt: 1, hasAssistantReply: false, messageCount: 1),
        ]
        let after: [String: ConversationSnapshot] = [
            "a": ConversationSnapshot(id: "a", title: "New title", createdAt: 1, hasAssistantReply: true, messageCount: 2),
            "b": ConversationSnapshot(id: "b", title: "Fresh chat", createdAt: 2, hasAssistantReply: false, messageCount: 0),
        ]

        let detail = SyncChangeSummary.describeConversationChanges(before: before, after: after)
        XCTAssertEqual(detail, "1 new: Fresh chat · 1 updated: New title")
    }

    func testDescribePush() {
        let detail = SyncChangeSummary.describePush(fileCount: 4, conversationCount: 2)
        XCTAssertEqual(detail, "Uploaded 2 conversations and 4 files.")
    }

    func testDescribePendingLocalChangesOnlyOneConversationUpdated() {
        let baseline: [String: ConversationSnapshot] = [
            "a": ConversationSnapshot(id: "a", title: "Alpha", createdAt: 1, hasAssistantReply: false, messageCount: 1),
            "b": ConversationSnapshot(id: "b", title: "Beta", createdAt: 2, hasAssistantReply: false, messageCount: 0),
        ]
        let current: [String: ConversationSnapshot] = [
            "a": ConversationSnapshot(id: "a", title: "Alpha", createdAt: 1, hasAssistantReply: true, messageCount: 2),
            "b": ConversationSnapshot(id: "b", title: "Beta", createdAt: 2, hasAssistantReply: false, messageCount: 0),
        ]

        let detail = SyncChangeSummary.describePendingLocalChanges(baseline: baseline, current: current)
        XCTAssertEqual(detail, "1 updated: Alpha")
    }

    func testDescribePendingLocalChangesTasksOnly() {
        let snapshot = ConversationSnapshot(id: "a", title: "Alpha", createdAt: 1, hasAssistantReply: false, messageCount: 1)
        let baseline = ["a": snapshot]
        let current = ["a": snapshot]

        let detail = SyncChangeSummary.describePendingLocalChanges(baseline: baseline, current: current)
        XCTAssertEqual(detail, "Task list changed.")
    }

    func testDescribePendingLocalChangesWithoutBaseline() {
        let current = [
            "a": ConversationSnapshot(id: "a", title: "Alpha", createdAt: 1, hasAssistantReply: false, messageCount: 1),
        ]
        XCTAssertNil(SyncChangeSummary.describePendingLocalChanges(baseline: [:], current: current))
    }
}
