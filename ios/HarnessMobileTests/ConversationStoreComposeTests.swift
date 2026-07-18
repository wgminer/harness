import XCTest
@testable import HarnessMobile

@MainActor
final class ConversationStoreComposeTests: XCTestCase {
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

    func testPruneEmptyConversationsRemovesMessagelessThreads() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let emptyId = try store.createConversation()
        let activeId = try store.createConversation()
        try store.appendMessage(conversationId: activeId, role: .user, content: "Hello")

        let removed = try store.pruneEmptyConversations()
        try store.reload()

        XCTAssertEqual(removed, 1)
        XCTAssertNil(try store.loadConversationMeta(conversationId: emptyId))
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, activeId)
    }

    func testAppendMessageSetsHasMessages() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = try store.createConversation()
        XCTAssertTrue(store.conversations.isEmpty, "Empty create must not appear in sidebar")

        try store.appendMessage(conversationId: id, role: .user, content: "First message")

        let meta = try store.loadConversationMeta(conversationId: id)
        XCTAssertEqual(meta?.hasMessages, true)
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
    }

    func testCreateConversationSkipsSidebarUntilMessages() throws {
        let store = ConversationStore(localDataDir: tempDir)
        _ = try store.createConversation()
        XCTAssertTrue(store.conversations.isEmpty)
    }

    func testReloadHidesMessagelessConversations() throws {
        let store = ConversationStore(localDataDir: tempDir)
        _ = try store.createConversation()
        let activeId = try store.createConversation()
        try store.appendMessage(conversationId: activeId, role: .user, content: "Visible")

        try store.reload()

        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, activeId)
    }

    func testDictationConversationAppearsInReload() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = try store.createDictationConversation(userMessage: "Dictated text")

        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
        XCTAssertEqual(try store.loadConversationMeta(conversationId: id)?.hasMessages, true)

        try store.reload()
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
    }

    func testReloadTrustsHasMessagesWithoutOpeningMessageFile() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = "conv_trust_meta"
        var map: [String: ConversationMeta] = [
            id: ConversationMeta(
                title: "Trusted",
                createdAt: 1,
                sessionKind: "chat",
                hasAssistantReply: false,
                hasMessages: true,
                titleSource: "auto"
            ),
        ]
        let mapPath = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.conversationsFile)
        try JSONEncoder().encode(map).write(to: mapPath, options: .atomic)
        // No messages file on disk — reload must still show the conversation.
        try store.reload()

        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
        XCTAssertTrue(store.conversations.first?.hasMessages == true)
    }

    func testReloadProbesDiskWhenHasMessagesMissing() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = "conv_legacy"
        let map: [String: ConversationMeta] = [
            id: ConversationMeta(
                title: "Legacy",
                createdAt: 2,
                sessionKind: "chat",
                hasAssistantReply: false,
                hasMessages: nil,
                titleSource: nil
            ),
        ]
        let mapPath = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.conversationsFile)
        try JSONEncoder().encode(map).write(to: mapPath, options: .atomic)
        let messagesPath = LocalDataLayout.fileURL(
            in: tempDir,
            relativePath: LocalDataLayout.messagesPath(conversationId: id)
        )
        let messages = [
            MessageRecord(role: "user", content: "hi", timestamp: 1, model: nil),
        ]
        try JSONEncoder().encode(messages).write(to: messagesPath, options: .atomic)

        try store.reload()

        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
    }

    func testLoadSidebarConversationsPrunesAndPublishesOnce() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let emptyId = try store.createConversation()
        let activeId = try store.createConversation()
        try store.appendMessage(conversationId: activeId, role: .user, content: "Hello")

        try store.loadSidebarConversations(pruningEmpty: true)

        XCTAssertNil(try store.loadConversationMeta(conversationId: emptyId))
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, activeId)
    }

    func testMessageRecordIdIsStableAcrossAccesses() {
        let message = MessageRecord(
            role: "assistant",
            content: "Hello from Harness",
            timestamp: 42,
            model: OpenAIModel.chat
        )
        XCTAssertEqual(message.id, message.id)
        XCTAssertTrue(message.id.hasPrefix("assistant-42-"))
    }
}
