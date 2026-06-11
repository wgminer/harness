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

        try store.appendMessage(conversationId: id, role: .user, content: "First message")
        try store.reload()

        let meta = try store.loadConversationMeta(conversationId: id)
        XCTAssertEqual(meta?.hasMessages, true)
        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
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

        try store.reload()

        XCTAssertEqual(store.conversations.count, 1)
        XCTAssertEqual(store.conversations.first?.id, id)
        XCTAssertEqual(try store.loadConversationMeta(conversationId: id)?.hasMessages, true)
    }
}
