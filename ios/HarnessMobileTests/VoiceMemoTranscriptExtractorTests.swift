import XCTest
@testable import HarnessMobile

final class VoiceMemoTranscriptExtractorTests: XCTestCase {
    func testExtractReturnsNilForNonAudioData() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("empty.m4a")
        try? Data([0x00, 0x01, 0x02]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNil(VoiceMemoTranscriptExtractor.extract(from: url))
    }

    func testExtractJoinsAttributedStringRuns() throws {
        let payload: [String: Any] = [
            "attributedString": [
                "runs": ["Hello ", "world"],
            ],
        ]
        let jsonData = try JSONSerialization.data(withJSONObject: payload)
        var fileData = Data("padding".utf8)
        fileData.append(jsonData)

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice_memo_test.m4a")
        try fileData.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertEqual(VoiceMemoTranscriptExtractor.extract(from: url), "Hello world")
    }
}
