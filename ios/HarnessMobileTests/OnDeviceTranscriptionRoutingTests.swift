import XCTest
@testable import HarnessMobile

final class OnDeviceTranscriptionRoutingTests: XCTestCase {
    func testLooksTruncatedRejectsSparseLongClip() {
        XCTAssertTrue(OnDeviceTranscriber.looksTruncated("hi", duration: 30))
        XCTAssertTrue(OnDeviceTranscriber.looksTruncated("", duration: 10))
    }

    func testLooksTruncatedAcceptsDenseDictation() {
        let text = String(repeating: "a", count: 80)
        XCTAssertFalse(OnDeviceTranscriber.looksTruncated(text, duration: 30))
    }

    func testLooksTruncatedUsesEmptyOnlyForShortClips() {
        XCTAssertTrue(OnDeviceTranscriber.looksTruncated("", duration: 3))
        XCTAssertFalse(OnDeviceTranscriber.looksTruncated("ok", duration: 3))
    }

    func testLooksTruncatedAllowsPauseHeavyNonEmptySpeech() {
        // ~1 char/sec — sparse but not a truncation stub.
        let text = String(repeating: "word ", count: 6)
        XCTAssertFalse(OnDeviceTranscriber.looksTruncated(text, duration: 30))
    }

    func testDefaultEngineIsOnDeviceNeverWhisper() {
        XCTAssertEqual(TranscriptionRouting.defaultEngine(), .onDevice)
        XCTAssertNotEqual(TranscriptionRouting.defaultEngine(), .whisper)
    }

    func testWhisperAvailabilityRequiresNonEmptyKey() {
        XCTAssertFalse(TranscriptionRouting.whisperAvailable(apiKey: nil))
        XCTAssertFalse(TranscriptionRouting.whisperAvailable(apiKey: ""))
        XCTAssertFalse(TranscriptionRouting.whisperAvailable(apiKey: "   "))
        XCTAssertTrue(TranscriptionRouting.whisperAvailable(apiKey: "sk-test"))
    }
}
