import XCTest
@testable import HarnessMobile

final class TranscriptDictionaryTests: XCTestCase {
    func testApplyReplacesWholeWordsOnly() {
        let dictionary = [
            TranscriptionDictionaryEntry(from: "Harness", to: "HARNESS"),
            TranscriptionDictionaryEntry(from: "API", to: "api"),
        ]
        let input = "Harness uses the API and reHarnessing"
        let output = TranscriptDictionary.apply(input, dictionary: dictionary)
        XCTAssertEqual(output, "HARNESS uses the api and reHarnessing")
    }

    func testApplyReturnsOriginalWhenDictionaryEmpty() {
        XCTAssertEqual(TranscriptDictionary.apply("hello", dictionary: []), "hello")
    }
}
