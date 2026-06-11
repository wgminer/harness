import XCTest
@testable import HarnessMobile

final class RecordingStorageTests: XCTestCase {
    func testParseTimestampFromFilename() {
        let date = RecordingStorage.parseTimestamp(from: "rec_1700000000000.m4a")
        XCTAssertEqual(date?.timeIntervalSince1970, 1_700_000_000)
    }

    func testParseTimestampReturnsNilForUnknownFilename() {
        XCTAssertNil(RecordingStorage.parseTimestamp(from: "voice_note.wav"))
    }

    func testFormattedDuration() {
        XCTAssertEqual(RecordingStorage.formattedDuration(65), "1:05")
        XCTAssertEqual(RecordingStorage.formattedDuration(4), "0:04")
    }

    func testListRecordingsSortsNewestFirst() throws {
        let dir = try RecordingStorage.recordingsDirectory()
        let older = dir.appendingPathComponent("rec_1000.m4a")
        let newer = dir.appendingPathComponent("rec_2000.m4a")
        try Data([0x00]).write(to: older)
        try Data([0x00]).write(to: newer)
        defer {
            try? FileManager.default.removeItem(at: older)
            try? FileManager.default.removeItem(at: newer)
        }

        let recordings = try RecordingStorage.listRecordings()
        let testNames = Set(["rec_1000.m4a", "rec_2000.m4a"])
        let listed = recordings.filter { testNames.contains($0.url.lastPathComponent) }
        XCTAssertEqual(listed.map(\.url.lastPathComponent), ["rec_2000.m4a", "rec_1000.m4a"])
    }

    func testListRecordingsRespectsLimit() throws {
        let dir = try RecordingStorage.recordingsDirectory()
        let first = dir.appendingPathComponent("rec_3000.m4a")
        let second = dir.appendingPathComponent("rec_4000.m4a")
        try Data([0x00]).write(to: first)
        try Data([0x00]).write(to: second)
        defer {
            try? FileManager.default.removeItem(at: first)
            try? FileManager.default.removeItem(at: second)
        }

        let all = try RecordingStorage.listRecordings()
        let limited = try RecordingStorage.listRecordings(limit: 2)
        XCTAssertEqual(limited.count, min(2, all.count))
        XCTAssertEqual(limited, Array(all.prefix(2)))
    }
}
