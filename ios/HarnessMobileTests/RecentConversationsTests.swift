import XCTest
@testable import HarnessMobile

final class RecentConversationsTests: XCTestCase {
    func testCleanDialogueBodyWindowsFromEnd() {
        let messages = [
            MessageRecord(role: "system", content: "ignore", timestamp: 1, model: nil),
            MessageRecord(role: "user", content: "old", timestamp: 2, model: nil),
            MessageRecord(role: "assistant", content: "old reply", timestamp: 3, model: nil),
            MessageRecord(role: "user", content: "new question", timestamp: 4, model: nil),
            MessageRecord(role: "assistant", content: "new answer", timestamp: 5, model: nil),
        ]
        let body = RecentConversations.cleanDialogueBody(messages: messages, budget: 50)
        XCTAssertTrue(body.contains("User: new question"))
        XCTAssertTrue(body.contains("Assistant: new answer"))
        XCTAssertFalse(body.contains("old reply"))
    }

    func testCleanDialogueBodyDropsToolOnlyAssistant() {
        let messages = [
            MessageRecord(
                role: "assistant",
                content: "",
                timestamp: 1,
                model: nil,
                toolCalls: [ToolCallRecord(toolName: "task_list", payload: nil)]
            ),
        ]
        XCTAssertTrue(RecentConversations.cleanDialogueBody(messages: messages, budget: 2000).isEmpty)
    }
}
