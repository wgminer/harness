import XCTest
@testable import HarnessMobile

final class ConversationStoreDeleteTests: XCTestCase {
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
    func testDeletesConversationAndMessages() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = try store.createConversation()
        try store.appendMessage(conversationId: id, role: .user, content: "Hello")

        try store.deleteConversation(id: id)

        XCTAssertTrue(store.conversations.isEmpty)
        XCTAssertTrue(try store.loadMessages(conversationId: id).isEmpty)
    }

    @MainActor
    func testSetUserTitlePersistsAndReloads() throws {
        let store = ConversationStore(localDataDir: tempDir)
        let id = try store.createConversation()
        try store.appendMessage(conversationId: id, role: .user, content: "Hello")

        try store.setUserTitle(conversationId: id, title: "My custom title")
        try store.reload()

        let meta = try store.loadConversationMeta(conversationId: id)
        XCTAssertEqual(meta?.title, "My custom title")
        XCTAssertEqual(meta?.titleSource, "user")
        XCTAssertEqual(store.conversations.first?.displayTitle, "My custom title")
    }
}
