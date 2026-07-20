import XCTest
@testable import HarnessMobile

final class RecordingCaptureValidationTests: XCTestCase {
    func testMissingFileFails() {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing_rec_\(UUID().uuidString).m4a")
        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 1,
            duration: 1
        )
        XCTAssertEqual(failure, .missingFile)
    }

    func testEmptyFileFailsAsMissing() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("empty_rec_\(UUID().uuidString).m4a")
        FileManager.default.createFile(atPath: url.path, contents: Data(), attributes: nil)
        defer { try? FileManager.default.removeItem(at: url) }

        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 1,
            duration: 1
        )
        XCTAssertEqual(failure, .missingFile)
    }

    func testTooShortFails() throws {
        let url = try makeTempFile(bytes: 64)
        defer { try? FileManager.default.removeItem(at: url) }

        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 1,
            duration: 0.1
        )
        XCTAssertEqual(failure, .tooShort)
    }

    func testNoSpeechPeakFails() throws {
        let url = try makeTempFile(bytes: 64)
        defer { try? FileManager.default.removeItem(at: url) }

        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 0.01,
            duration: 1.0
        )
        XCTAssertEqual(failure, .noSpeechDetected)
    }

    func testValidClipPasses() throws {
        let url = try makeTempFile(bytes: 64)
        defer { try? FileManager.default.removeItem(at: url) }

        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 0.2,
            duration: 1.0
        )
        XCTAssertNil(failure)
    }

    func testExplicitElapsedDurationPreferredOverMissingAssetDuration() throws {
        // Non-audio bytes → AVURLAsset.duration is nil/0; wall-clock elapsed must win.
        let url = try makeTempFile(bytes: 64)
        defer { try? FileManager.default.removeItem(at: url) }

        let failure = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 0.2,
            duration: 1.5
        )
        XCTAssertNil(failure)

        let tooShort = RecordingCaptureValidation.validate(
            url: url,
            peakLevelDuringSession: 0.2,
            duration: 0.1
        )
        XCTAssertEqual(tooShort, .tooShort)
    }

    func testUserMessagesAreNonEmpty() {
        for failure in [
            RecordingCaptureValidation.Failure.missingFile,
            .tooShort,
            .noSpeechDetected,
        ] {
            XCTAssertFalse(RecordingCaptureValidation.userMessage(for: failure).isEmpty)
        }
    }

    private func makeTempFile(bytes: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("valid_rec_\(UUID().uuidString).m4a")
        let data = Data(repeating: 1, count: bytes)
        try data.write(to: url)
        return url
    }
}
