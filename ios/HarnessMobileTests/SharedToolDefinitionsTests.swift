import XCTest
@testable import HarnessMobile

/// Drift guard for the shared `resources/contracts/tools.json`: parses on the iOS side and
/// contains every tool name desktop also needs from the same file (see the Rust counterpart
/// `tool_definitions_parses_and_contains_expected_names` in `src-tauri/src/openai.rs`).
final class SharedToolDefinitionsTests: XCTestCase {
    func testLoadsNonEmptyDefinitions() {
        XCTAssertFalse(SharedToolDefinitions.all.isEmpty, "tools.json should load from the app bundle")
    }

    func testContainsAllIosSupportedToolNames() {
        let names = toolNames(from: SharedToolDefinitions.all)
        let expected = TaskToolDefinitions.toolNames.union(ChatToolDefinitions.toolNames)
        for name in expected {
            XCTAssertTrue(names.contains(name), "shared tools.json is missing iOS-used tool: \(name)")
        }
    }

    func testContainsDesktopOnlyToolNames() {
        let names = toolNames(from: SharedToolDefinitions.all)
        for name in ["list_directory", "read_file", "write_file", "delete_file", "create_directory", "set_layout",
                     "note_list", "note_create", "note_read", "note_save", "note_delete"] {
            XCTAssertTrue(names.contains(name), "shared tools.json is missing desktop-only tool: \(name)")
        }
    }

    func testFilteredReturnsOnlyRequestedNames() {
        let filtered = SharedToolDefinitions.filtered(names: ["get_datetime", "web_search"])
        XCTAssertEqual(toolNames(from: filtered), ["get_datetime", "web_search"])
    }

    func testTaskToolDefinitionsMatchesSharedSchema() {
        let names = toolNames(from: TaskToolDefinitions.openAITools)
        XCTAssertEqual(names, TaskToolDefinitions.toolNames)
    }

    private func toolNames(from tools: [[String: Any]]) -> Set<String> {
        Set(tools.compactMap { tool in
            (tool["function"] as? [String: Any])?["name"] as? String
        })
    }
}
