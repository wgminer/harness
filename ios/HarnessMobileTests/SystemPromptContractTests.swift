import XCTest
@testable import HarnessMobile

/// Drift guard for `resources/contracts/systemPrompt.json`: iOS loads it as a bundled
/// resource (same file desktop `include_str!`s and TypeScript imports).
final class SystemPromptContractTests: XCTestCase {
    func testDefaultsLoadFromBundledContract() {
        let defaults = SystemPromptSettings.defaults
        XCTAssertFalse(defaults.shared.isEmpty, "systemPrompt.json shared should load from the app bundle")
        XCTAssertFalse(defaults.desktop.isEmpty)
        XCTAssertFalse(defaults.ios.isEmpty)
        XCTAssertTrue(defaults.shared.contains("[CONVERSATION_RECALL]"))
        XCTAssertFalse(defaults.shared.contains("[FORMATTING_CAPABILITIES]"))
        XCTAssertTrue(defaults.desktop.contains("[FORMATTING_CAPABILITIES]"))
        XCTAssertFalse(defaults.ios.contains("[FORMATTING_CAPABILITIES]"))
        XCTAssertTrue(defaults.ios.contains("Here Mobile"))
    }

    func testIosPromptWebSearchInjectionStillWorks() {
        let prompt = SystemPromptSettings.iosPrompt(
            base: SystemPromptSettings.defaults.ios,
            includeWebSearch: true
        )
        XCTAssertTrue(prompt.contains("web_search"))
    }
}
