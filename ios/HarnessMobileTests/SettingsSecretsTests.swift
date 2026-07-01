import XCTest
@testable import HarnessMobile

final class SettingsSecretsTests: XCTestCase {
    func testStripSettingsSecretsRemovesApiKeys() {
        let raw: [String: Any] = [
            "openai": ["apiKey": "secret", "model": "gpt"],
            "search": ["tavilyApiKey": "tvly", "enabled": true],
            "sync": ["bucket": "harness"],
        ]
        let stripped = SettingsSecrets.stripSettingsSecrets(raw)
        let openai = stripped["openai"] as? [String: Any]
        let search = stripped["search"] as? [String: Any]
        XCTAssertNil(openai?["apiKey"])
        XCTAssertEqual(openai?["model"] as? String, "gpt")
        XCTAssertNil(search?["tavilyApiKey"])
        XCTAssertEqual(search?["enabled"] as? Bool, true)
        XCTAssertNotNil(stripped["sync"])
    }
}
