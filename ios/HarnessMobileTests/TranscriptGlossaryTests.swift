import XCTest
@testable import HarnessMobile

final class TranscriptGlossaryTests: XCTestCase {
    func testNormalizeDropsEmptiesAndDedupes() {
        XCTAssertEqual(
            TranscriptGlossary.normalize([" Cursor ", "", "cursor", "Harness"]),
            ["Cursor", "Harness"]
        )
    }

    func testMigratesLegacyDictionaryToReplacementTerm() {
        let dictionary: [[String: Any]] = [
            ["from": "cursor", "to": "Cursor"],
            ["from": "um", "to": ""],
            ["from": "Harness", "to": "Harness"],
        ]
        XCTAssertEqual(
            TranscriptGlossary.fromLegacyDictionary(dictionary),
            ["Cursor", "Harness"]
        )
    }

    func testResolvePrefersExplicitEmptyGlossary() {
        let transcription: [String: Any] = [
            "glossary": [String](),
            "dictionary": [["from": "c", "to": "Cursor"]],
        ]
        XCTAssertEqual(TranscriptGlossary.resolve(from: transcription), [])
    }

    func testAppendPreferredSpellings() {
        let output = TranscriptGlossary.appendPreferredSpellings(
            prompt: "Keep it terse.",
            terms: ["Cursor", "Harness"]
        )
        XCTAssertTrue(output.hasPrefix("Keep it terse.\n\n"))
        XCTAssertTrue(output.contains("- Cursor"))
        XCTAssertTrue(output.contains("- Harness"))
        XCTAssertTrue(output.contains(TranscriptCleanupContract.defaults.preferredSpellingsHeader))
    }

    func testEmptyGlossaryLeavesPromptUnchanged() {
        XCTAssertEqual(
            TranscriptGlossary.appendPreferredSpellings(prompt: "Keep it terse.", terms: []),
            "Keep it terse."
        )
    }
}
