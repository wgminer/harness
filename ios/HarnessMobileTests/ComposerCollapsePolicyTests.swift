import XCTest
@testable import HarnessMobile

final class ComposerCollapsePolicyTests: XCTestCase {
    func testCollapsedWhenUnfocusedAndNotHeld() {
        XCTAssertTrue(
            ComposerCollapsePolicy.isCollapsed(
                allowsCollapse: true,
                heldExpanded: false,
                isFocused: false
            )
        )
    }

    func testExpandedWhileFocusedEvenWithHeldFalse() {
        XCTAssertFalse(
            ComposerCollapsePolicy.isCollapsed(
                allowsCollapse: true,
                heldExpanded: false,
                isFocused: true
            )
        )
    }

    func testExpandedDuringFocusBridge() {
        XCTAssertFalse(
            ComposerCollapsePolicy.isCollapsed(
                allowsCollapse: true,
                heldExpanded: true,
                isFocused: false
            )
        )
    }

    func testNeverCollapsedWhenCollapseDisallowed() {
        XCTAssertFalse(
            ComposerCollapsePolicy.isCollapsed(
                allowsCollapse: false,
                heldExpanded: false,
                isFocused: false
            )
        )
    }

    func testCollapsedLabelShowsPlaceholderWhenEmpty() {
        XCTAssertEqual(ComposerCollapsePolicy.collapsedLabel(draft: ""), "Type a message…")
        XCTAssertEqual(ComposerCollapsePolicy.collapsedLabel(draft: "   "), "Type a message…")
    }

    func testCollapsedLabelShowsDraftPreview() {
        XCTAssertEqual(ComposerCollapsePolicy.collapsedLabel(draft: "  hello world  "), "hello world")
    }

    func testReleaseExpandedWheneverUnfocused() {
        XCTAssertTrue(ComposerCollapsePolicy.shouldReleaseExpanded(isFocused: false))
        XCTAssertFalse(ComposerCollapsePolicy.shouldReleaseExpanded(isFocused: true))
    }
}
