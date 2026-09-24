import XCTest
@testable import HarnessMobile

final class TranscriptionSettingsTests: XCTestCase {
    func testParseUsesDefaultsWhenMissing() {
        let settings = TranscriptionSettings.parse([:])
        XCTAssertTrue(settings.autoSend)
        XCTAssertFalse(settings.cleanup.enabled)
        XCTAssertTrue(settings.glossary.isEmpty)
        XCTAssertEqual(settings.cleanup.prompt, TranscriptCleanupContract.defaults.defaultPrompt)
    }

    func testParseReadsGlossary() throws {
        let json: [String: Any] = [
            "recording": ["autoSend": false],
            "transcription": [
                "cleanup": [
                    "enabled": true,
                    "prompt": "Keep it terse.",
                ],
                "glossary": ["Cursor", "Harness"],
            ],
        ]
        let settings = TranscriptionSettings.parse(json)
        XCTAssertFalse(settings.autoSend)
        XCTAssertTrue(settings.cleanup.enabled)
        XCTAssertEqual(settings.cleanup.prompt, "Keep it terse.")
        XCTAssertEqual(settings.glossary, ["Cursor", "Harness"])
    }

    func testParseMigratesLegacyDictionary() {
        let json: [String: Any] = [
            "transcription": [
                "dictionary": [
                    ["from": "cursor", "to": "Cursor"],
                ],
            ],
        ]
        let settings = TranscriptionSettings.parse(json)
        XCTAssertEqual(settings.glossary, ["Cursor"])
    }

    func testUpdatePhoneTogglesPreservesOtherKeys() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("transcription-settings-\(UUID().uuidString)", isDirectory: true)
        try LocalDataLayout.ensureDirectories(at: dir)

        let path = LocalDataLayout.fileURL(in: dir, relativePath: LocalDataLayout.settingsFile)
        let seed: [String: Any] = [
            "openai": ["apiKey": "sk-keep"],
            "recording": ["autoSend": true, "extra": "stay"],
            "transcription": [
                "cleanup": [
                    "enabled": false,
                    "prompt": "Keep it terse.",
                ],
                "glossary": ["Harness"],
            ],
            "search": ["tavilyApiKey": "tvly-keep"],
        ]
        let seedData = try JSONSerialization.data(withJSONObject: seed, options: [.prettyPrinted, .sortedKeys])
        try seedData.write(to: path, options: .atomic)

        try TranscriptionSettings.updatePhoneToggles(autoSend: false, cleanupEnabled: true, in: dir)

        let data = try LocalDataLayout.readRegularFileData(at: path)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((json["openai"] as? [String: Any])?["apiKey"] as? String, "sk-keep")
        XCTAssertEqual((json["search"] as? [String: Any])?["tavilyApiKey"] as? String, "tvly-keep")
        XCTAssertEqual((json["recording"] as? [String: Any])?["autoSend"] as? Bool, false)
        XCTAssertEqual((json["recording"] as? [String: Any])?["extra"] as? String, "stay")
        let transcription = try XCTUnwrap(json["transcription"] as? [String: Any])
        let cleanup = try XCTUnwrap(transcription["cleanup"] as? [String: Any])
        XCTAssertEqual(cleanup["enabled"] as? Bool, true)
        XCTAssertEqual(cleanup["prompt"] as? String, "Keep it terse.")
        XCTAssertEqual(transcription["glossary"] as? [String], ["Harness"])

        let loaded = TranscriptionSettings.load(from: dir)
        XCTAssertFalse(loaded.autoSend)
        XCTAssertTrue(loaded.cleanup.enabled)
        XCTAssertEqual(loaded.cleanup.prompt, "Keep it terse.")
        XCTAssertEqual(loaded.glossary, ["Harness"])
    }
}
