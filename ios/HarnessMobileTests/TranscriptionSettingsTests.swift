import XCTest
@testable import HarnessMobile

final class TranscriptionSettingsTests: XCTestCase {
    func testParseUsesDefaultsWhenMissing() {
        let settings = TranscriptionSettings.parse([:])
        XCTAssertTrue(settings.autoSend)
        XCTAssertFalse(settings.cleanup.enabled)
        XCTAssertTrue(settings.dictionary.isEmpty)
    }

    func testParseReadsNestedSettings() throws {
        let json: [String: Any] = [
            "recording": ["autoSend": false],
            "transcription": [
                "cleanup": [
                    "enabled": true,
                    "prompt": "Keep it terse.",
                ],
                "dictionary": [
                    ["from": "Cursor", "to": "cursor"],
                ],
            ],
        ]
        let settings = TranscriptionSettings.parse(json)
        XCTAssertFalse(settings.autoSend)
        XCTAssertTrue(settings.cleanup.enabled)
        XCTAssertEqual(settings.cleanup.prompt, "Keep it terse.")
        XCTAssertEqual(settings.dictionary.count, 1)
        XCTAssertEqual(settings.dictionary.first?.from, "Cursor")
        XCTAssertEqual(settings.dictionary.first?.to, "cursor")
    }
}
