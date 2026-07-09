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
