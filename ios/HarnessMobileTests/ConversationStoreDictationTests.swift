import XCTest
@testable import HarnessMobile

@MainActor
final class ConversationStoreDictationTests: XCTestCase {
    private var tempDir: URL!

    override func setUp() async throws {
        tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try LocalDataLayout.ensureDirectories(at: tempDir)
    }

    override func tearDown() async throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
    }

    func testCreateDictationConversationSetsSessionKindAndTitle() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let recording = try RecordingStorage.newRecordingURL()
        try Data([0x00]).write(to: recording)
        let id = try store.createDictationConversation(
            userMessage: "Hello from dictation",
            recordingURL: recording
        )

        let meta = try store.loadConversationMeta(conversationId: id)
        XCTAssertEqual(meta?.sessionKind, "dictation")
        XCTAssertTrue(ConversationTitlePolicy.isTimePlaceholderTitle(meta?.title))
        XCTAssertEqual(meta?.titleSource, "auto")

        let messages = try store.loadMessages(conversationId: id)
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages.first?.content, "Hello from dictation")
        XCTAssertEqual(messages.first?.messageRole, .user)

        try store.reload()
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)

        XCTAssertEqual(DictationRecordingIndex.recordingURL(for: id)?.lastPathComponent, recording.lastPathComponent)
    }

    func testPopLastUserMessageRemovesUserBubble() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = try store.createDictationConversation(userMessage: "Remove me")

        let popped = try store.popLastUserMessage(conversationId: id)
        XCTAssertEqual(popped, "Remove me")
        XCTAssertTrue(try store.loadMessages(conversationId: id).isEmpty)
    }
}
