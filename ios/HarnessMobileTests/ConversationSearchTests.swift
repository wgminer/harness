import XCTest
@testable import HarnessMobile

final class ConversationSearchTests: XCTestCase {
    private var tempDir: URL!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("conversation-search-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        try LocalDataLayout.ensureDirectories(at: tempDir)
    }

    override func tearDownWithError() throws {
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
        tempDir = nil
    }

    func testEmptyQueryReturnsNoResults() throws {
        try writeConversation(id: "conv_a", title: "Hello", createdAt: 100)
        let results = try ConversationSearch.search(in: tempDir, query: "   ")
        XCTAssertTrue(results.isEmpty)
    }

    func testSearchMatchesTitle() throws {
        try writeConversation(id: "conv_a", title: "My Search Title", createdAt: 200)
        try writeMessages(
            conversationId: "conv_a",
            messages: [MessageRecord(role: "user", content: "unrelated", timestamp: 200, model: nil)]
        )

        let results = try ConversationSearch.search(in: tempDir, query: "search")
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "conv_a")
        XCTAssertTrue(results[0].titleMatched)
        XCTAssertEqual(results[0].titleMatchRange, [3, 9])
    }

    func testSearchMatchesMessageBody() throws {
        try writeConversation(id: "conv_b", title: "Other", createdAt: 300)
        try writeMessages(
            conversationId: "conv_b",
            messages: [
                MessageRecord(
                    role: "user",
                    content: "line1\nneedle appears here\nline3",
                    timestamp: 300,
                    model: nil
                ),
            ]
        )

        let results = try ConversationSearch.search(in: tempDir, query: "needle")
        XCTAssertEqual(results.count, 1)
        XCTAssertTrue(results[0].snippet.lowercased().contains("needle"))
        XCTAssertGreaterThanOrEqual(results[0].snippetMatchRange[0], 0)
    }

    func testSearchSortsNewestFirst() throws {
        try writeConversation(id: "old", title: "budget old", createdAt: 100)
        try writeConversation(id: "new", title: "budget new", createdAt: 500)

        let results = try ConversationSearch.search(in: tempDir, query: "budget")
        XCTAssertEqual(results.map(\.id), ["new", "old"])
    }

    func testExtractSnippetReturnsClampedMatchRange() {
        let extracted = ConversationSearch.extractSnippet(
            content: "abc def ghi",
            queryLower: "def",
            matchIndex: 4
        )
        XCTAssertTrue(extracted.snippet.contains("def"))
        XCTAssertEqual(extracted.snippetMatchRange, [4, 7])
    }

    func testNoMatchReturnsEmpty() throws {
        try writeConversation(id: "conv_a", title: "Hello", createdAt: 100)
        let results = try ConversationSearch.search(in: tempDir, query: "missing")
        XCTAssertTrue(results.isEmpty)
    }

    private func writeConversation(id: String, title: String, createdAt: Int64) throws {
        let path = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.conversationsFile)
        var map: [String: ConversationMeta] = [:]
        if FileManager.default.fileExists(atPath: path.path),
           let data = try? LocalDataLayout.readRegularFileData(at: path),
           !data.isEmpty
        {
            map = (try? JSONDecoder().decode([String: ConversationMeta].self, from: data)) ?? [:]
        }
        map[id] = ConversationMeta(
            title: title,
            createdAt: createdAt,
            sessionKind: "chat",
            hasAssistantReply: false,
            titleSource: "auto"
        )
        let data = try JSONEncoder().encode(map)
        try data.write(to: path, options: .atomic)
    }

    private func writeMessages(conversationId: String, messages: [MessageRecord]) throws {
        let path = LocalDataLayout.fileURL(
            in: tempDir,
            relativePath: LocalDataLayout.messagesPath(conversationId: conversationId)
        )
        let data = try JSONEncoder().encode(messages)
        try data.write(to: path, options: .atomic)
    }
}
