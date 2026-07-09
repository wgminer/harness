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

    func testShouldUnlockWhenUserScrollsUp() {
        XCTAssertTrue(ChatScrollLogic.shouldUnlockFromScrollDelta(prevOffset: 500, nextOffset: 400))
        XCTAssertFalse(ChatScrollLogic.shouldUnlockFromScrollDelta(prevOffset: 400, nextOffset: 500))
        XCTAssertFalse(ChatScrollLogic.shouldUnlockFromScrollDelta(prevOffset: 400, nextOffset: 399))
    }

    func testShouldRepinOnlyWhenUserScrollsDownToLiveEdge() {
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinFromUserScroll(
                mode: .free,
                prevOffset: 460,
                nextOffset: 480,
                nearLiveEdge: true
            ),
            .pinned
        )
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinFromUserScroll(
                mode: .free,
                prevOffset: 480,
                nextOffset: 460,
                nearLiveEdge: true
            ),
            .free
        )
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinFromUserScroll(
                mode: .free,
                prevOffset: 460,
                nextOffset: 480,
                nearLiveEdge: false
            ),
            .free
        )
        XCTAssertEqual(
            ChatScrollLogic.shouldRepinFromUserScroll(
                mode: .pinned,
                prevOffset: 460,
                nextOffset: 480,
                nearLiveEdge: true
            ),
            .pinned
        )
    }

    func testDoesNotSnapOnStreamEnd() {
        XCTAssertFalse(ChatScrollLogic.didTurnJustStart(prevSending: true, sending: false))
    }
}
