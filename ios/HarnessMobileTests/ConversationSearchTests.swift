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

    func testParseLibraryHref() {
        XCTAssertEqual(ConversationSearch.parseLibraryHref("/c/conv_a")?.id, "conv_a")
        XCTAssertEqual(ConversationSearch.parseLibraryHref("`/n/note_1`")?.target, .note)
        XCTAssertNil(ConversationSearch.parseLibraryHref("/etc/passwd"))
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
        XCTAssertEqual(results[0].kind, .chat)
        XCTAssertTrue(results[0].titleMatched)
        XCTAssertEqual(results[0].titleMatchRange, [3, 9])
    }

    func testSearchMatchesMessageBodyWithTokenization() throws {
        try writeConversation(id: "conv_b", title: "Other", createdAt: 300)
        try writeMessages(
            conversationId: "conv_b",
            messages: [
                MessageRecord(
                    role: "user",
                    content: "We are renovating the kitchen this month",
                    timestamp: 300,
                    model: nil
                ),
            ]
        )

        let results = try ConversationSearch.search(in: tempDir, query: "kitchen renovation")
        XCTAssertEqual(results.count, 1)
        XCTAssertTrue(results[0].snippet.lowercased().contains("kitchen"))
    }

    func testDictationKind() throws {
        try writeConversation(
            id: "dict_a",
            title: "Dictation @ 3:45 PM",
            createdAt: 400,
            sessionKind: "dictation"
        )
        try writeMessages(
            conversationId: "dict_a",
            messages: [MessageRecord(role: "user", content: "Budget meeting notes", timestamp: 400, model: nil)]
        )

        let results = try ConversationSearch.search(in: tempDir, query: "budget")
        XCTAssertEqual(results.first?.kind, .dictation)
    }

    func testSearchSortsByScoreThenRecency() throws {
        try writeConversation(id: "old", title: "budget old", createdAt: 100)
        try writeConversation(id: "new", title: "budget new", createdAt: 500)
        try writeMessages(
            conversationId: "old",
            messages: [MessageRecord(role: "user", content: "budget old thread", timestamp: 100, model: nil)]
        )
        try writeMessages(
            conversationId: "new",
            messages: [MessageRecord(role: "user", content: "budget new thread", timestamp: 500, model: nil)]
        )

        let results = try ConversationSearch.search(in: tempDir, query: "budget")
        XCTAssertEqual(results.map(\.id), ["new", "old"])
    }

    func testLibrarySearchIncludesNotes() throws {
        try writeNote(id: "note_a", title: "Kitchen remodel plan", updatedAt: 150)
        let hits = try ConversationSearch.searchLibrary(in: tempDir, query: "kitchen")
        XCTAssertTrue(hits.contains { $0.kind == .note && $0.id == "note_a" })
    }

    func testExtractSnippetReturnsClampedMatchRange() {
        let extracted = ConversationSearch.extractSnippet(content: "abc def ghi", matchIndex: 4, matchLen: 3)
        XCTAssertTrue(extracted.snippet.contains("def"))
        XCTAssertEqual(extracted.snippetMatchRange, [4, 7])
    }

    func testNoMatchReturnsEmpty() throws {
        try writeConversation(id: "conv_a", title: "Hello", createdAt: 100)
        let results = try ConversationSearch.search(in: tempDir, query: "missing")
        XCTAssertTrue(results.isEmpty)
    }

    private func writeConversation(
        id: String,
        title: String,
        createdAt: Int64,
        sessionKind: String = "chat"
    ) throws {
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
            sessionKind: sessionKind,
            hasAssistantReply: false,
            hasMessages: true,
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

    private func writeNote(id: String, title: String, updatedAt: Int64) throws {
        let path = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.notesIndexFile)
        let payload: [String: Any] = [
            "notes": [
                [
                    "id": id,
                    "title": title,
                    "createdAt": updatedAt,
                    "updatedAt": updatedAt,
                    "wordCount": 1,
                ] as [String: Any],
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        try data.write(to: path, options: .atomic)
    }
}
