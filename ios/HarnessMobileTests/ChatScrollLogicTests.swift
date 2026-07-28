import XCTest
@testable import HarnessMobile

final class ChatScrollLogicTests: XCTestCase {
    func testDistanceFromLiveEdge() {
        XCTAssertEqual(ChatScrollLogic.distanceFromLiveEdge(contentBottom: 900, viewportBottom: 800), 100)
    }

    func testIsNearLiveEdgeWithinTolerance() {
        XCTAssertTrue(ChatScrollLogic.isNearLiveEdge(contentBottom: 820, viewportBottom: 800))
        XCTAssertFalse(ChatScrollLogic.isNearLiveEdge(contentBottom: 900, viewportBottom: 800, tolerance: 16))
    }

    func testDidTurnJustStartRisingEdgeOnly() {
        XCTAssertTrue(ChatScrollLogic.didTurnJustStart(prevSending: false, sending: true))
        XCTAssertFalse(ChatScrollLogic.didTurnJustStart(prevSending: true, sending: true))
        XCTAssertFalse(ChatScrollLogic.didTurnJustStart(prevSending: true, sending: false))
        XCTAssertFalse(ChatScrollLogic.didTurnJustStart(prevSending: false, sending: false))
    }

    func testShouldFollowTranscriptResizeOnlyWhilePinnedAndNotTakenOver() {
        XCTAssertTrue(ChatScrollLogic.shouldFollowTranscriptResize(mode: .pinned, userTookOver: false))
        XCTAssertFalse(ChatScrollLogic.shouldFollowTranscriptResize(mode: .pinned, userTookOver: true))
        XCTAssertFalse(ChatScrollLogic.shouldFollowTranscriptResize(mode: .free, userTookOver: false))
        XCTAssertFalse(ChatScrollLogic.shouldFollowTranscriptResize(mode: .free, userTookOver: true))
    }

    func testShouldRepinWhenNearLiveEdgeWhileFree() {
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinNearLiveEdge(mode: .free, nearLiveEdge: true),
            .pinned
        )
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinNearLiveEdge(mode: .free, nearLiveEdge: false),
            .free
        )
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinNearLiveEdge(mode: .pinned, nearLiveEdge: true),
            .pinned
        )
    }

    func testDoesNotSnapOnStreamEnd() {
        XCTAssertFalse(ChatScrollLogic.didTurnJustStart(prevSending: true, sending: false))
    }
}
