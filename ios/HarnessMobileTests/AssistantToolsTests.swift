import XCTest
@testable import HarnessMobile

@MainActor
final class AssistantToolsTests: XCTestCase {
    private var tempDir: URL!

    override func setUp() async throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("assistant-tools-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        try LocalDataLayout.ensureDirectories(at: tempDir)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: tempDir)
    }

    func testGetDatetimeReturnsExpectedKeys() async throws {
        let store = ConversationStore(localDataDir: tempDir)
        let raw = try await AssistantTools.execute(
            name: "get_datetime",
            args: ["timezone": "UTC"],
            store: store
        )
        let object = try decodeJSONObject(raw)
        XCTAssertEqual(object["timezone"] as? String, "UTC")
        XCTAssertNotNil(object["epoch_ms"])
        XCTAssertNotNil(object["utc_iso"])
        XCTAssertNotNil(object["offset"])
        XCTAssertNotNil(object["local_iso"])
        XCTAssertNotNil(object["formatted"])
    }

    func testGetDatetimeRejectsInvalidTimezone() async throws {
        let store = ConversationStore(localDataDir: tempDir)
        let raw = try await AssistantTools.execute(
            name: "get_datetime",
            args: ["timezone": "Not/A/Timezone"],
            store: store
        )
        let object = try decodeJSONObject(raw)
        XCTAssertEqual(object["error"] as? String, "Invalid timezone: Not/A/Timezone")
    }

    func testMemorySetAndListFactsPersist() async throws {
        let store = ConversationStore(localDataDir: tempDir)
        let setRaw = try await AssistantTools.execute(
            name: "memory_set_fact",
            args: ["key": "favorite_color", "value": "blue"],
            store: store
        )
        let setObject = try decodeJSONObject(setRaw)
        XCTAssertEqual(setObject["lastAction"] as? String, "set_fact")
        XCTAssertEqual((setObject["memory"] as? [String: String])?["favorite_color"], "blue")

        let listRaw = try await AssistantTools.execute(name: "memory_list_facts", args: [:], store: store)
        let listObject = try decodeJSONObject(listRaw)
        XCTAssertEqual(listObject["lastAction"] as? String, "list_facts")
        XCTAssertEqual((listObject["memory"] as? [String: String])?["favorite_color"], "blue")
    }

    func testMemorySetFactWithEmptyKeyDoesNotWrite() async throws {
        let store = ConversationStore(localDataDir: tempDir)
        _ = try await AssistantTools.execute(
            name: "memory_set_fact",
            args: ["key": " ", "value": "ignored"],
            store: store
        )
        let memoryPath = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.userMemoryFile)
        XCTAssertFalse(FileManager.default.fileExists(atPath: memoryPath.path))
    }

    func testWebSearchWithoutApiKeyReturnsErrorPayload() async throws {
        let store = ConversationStore(localDataDir: tempDir)
        let raw = try await AssistantTools.execute(
            name: "web_search",
            args: ["query": "harness app"],
            store: store
        )
        let object = try decodeJSONObject(raw)
        XCTAssertEqual(object["query"] as? String, "harness app")
        XCTAssertTrue((object["error"] as? String ?? "").contains("Tavily API key is not set"))
        XCTAssertEqual((object["results"] as? [Any])?.count, 0)
    }

    func testOpenAIToolsOmitsWebSearchWithoutTavilyKey() {
        let tools = AssistantToolDefinitions.openAITools(in: tempDir)
        let names = toolNames(from: tools)
        XCTAssertTrue(names.contains("get_datetime"))
        XCTAssertTrue(names.contains("memory_set_fact"))
        XCTAssertFalse(names.contains("web_search"))
    }

    func testOpenAIToolsIncludesWebSearchWhenTavilyKeyPresent() throws {
        let settingsPath = LocalDataLayout.fileURL(in: tempDir, relativePath: LocalDataLayout.settingsFile)
        let settings = #"{"search":{"tavilyApiKey":"tvly-test"}}"#
        try settings.data(using: .utf8)!.write(to: settingsPath)

        let tools = AssistantToolDefinitions.openAITools(in: tempDir)
        let names = toolNames(from: tools)
        XCTAssertTrue(names.contains("web_search"))
    }

    func testIosPromptAddsWebSearchWhenEnabled() {
        let prompt = SystemPromptSettings.iosPrompt(
            base: SystemPromptSettings.defaults.ios,
            includeWebSearch: true
        )
        XCTAssertTrue(prompt.contains("web_search"))
    }

    private func decodeJSONObject(_ raw: String) throws -> [String: Any] {
        let data = try XCTUnwrap(raw.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func toolNames(from tools: [[String: Any]]) -> Set<String> {
        Set(tools.compactMap { tool in
            (tool["function"] as? [String: Any])?["name"] as? String
        })
    }
}
