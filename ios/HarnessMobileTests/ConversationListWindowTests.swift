import XCTest
@testable import HarnessMobile

final class ConversationListWindowTests: XCTestCase {
    func testDefaultsMatchDesktopSidebarWindow() {
        XCTAssertEqual(ConversationListWindow.initialVisibleCount, 20)
        XCTAssertEqual(ConversationListWindow.moreIncrement, 20)
    }

    func testVisibleItemsPrefixesWhenNotSearching() {
        let items = Array(1...25)
        XCTAssertEqual(
            ConversationListWindow.visibleItems(items, limit: 20, searching: false),
            Array(1...20)
        )
    }

    func testVisibleItemsShowsAllWhileSearching() {
        let items = Array(1...25)
        XCTAssertEqual(
            ConversationListWindow.visibleItems(items, limit: 20, searching: true),
            items
        )
    }

    func testShowsMoreOnlyWhenTruncatedAndNotSearching() {
        XCTAssertTrue(
            ConversationListWindow.showsMoreControl(totalCount: 25, visibleCount: 20, searching: false)
        )
        XCTAssertFalse(
            ConversationListWindow.showsMoreControl(totalCount: 25, visibleCount: 20, searching: true)
        )
        XCTAssertFalse(
            ConversationListWindow.showsMoreControl(totalCount: 20, visibleCount: 20, searching: false)
        )
    }

    func testNextLimitCapsAtTotal() {
        XCTAssertEqual(ConversationListWindow.nextLimit(current: 20, totalCount: 45), 40)
        XCTAssertEqual(ConversationListWindow.nextLimit(current: 40, totalCount: 45), 45)
    }
}
