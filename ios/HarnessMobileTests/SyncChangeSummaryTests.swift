import XCTest
@testable import HarnessMobile

final class SyncChangeSummaryTests: XCTestCase {
    func testDescribeNoopWithConversations() {
        let detail = SyncChangeSummary.describeNoop(hasLocalEdits: false, conversationCount: 3)
        XCTAssertEqual(detail, "Phone and backup folder match. 3 conversations in sync.")
    }

    func testDescribeNoopWithLocalEdits() {
        let detail = SyncChangeSummary.describeNoop(hasLocalEdits: true, conversationCount: 1)
        XCTAssertEqual(detail, "Revisions match, but this phone still has unsaved local edits.")
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
}
