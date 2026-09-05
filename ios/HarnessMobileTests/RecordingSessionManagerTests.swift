import XCTest
@testable import HarnessMobile

@MainActor
final class RecordingSessionManagerTests: XCTestCase {
    func testLiveActivityStopNotificationSetsFlag() {
        let manager = RecordingSessionManager()
        XCTAssertFalse(manager.liveActivityStopRequested)

        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        XCTAssertTrue(manager.liveActivityStopRequested)
    }

    func testAcknowledgeLiveActivityStopRequestClearsFlag() {
        let manager = RecordingSessionManager()
        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        XCTAssertTrue(manager.liveActivityStopRequested)

        manager.acknowledgeLiveActivityStopRequest()
        XCTAssertFalse(manager.liveActivityStopRequested)
    }
}

@MainActor
final class AudioRecorderCancelTests: XCTestCase {
    func testConsumePreservedRecordingURLTransfersOwnershipWithoutDeleting() throws {
        let recorder = AudioRecorder()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("preserved_rec_\(UUID().uuidString).m4a")
        try Data([1, 2, 3]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        recorder.testSeedPreservedRecordingURL(url)
        XCTAssertEqual(recorder.consumePreservedRecordingURL(), url)
        XCTAssertNil(recorder.preservedRecordingURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }
}
