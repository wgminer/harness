import XCTest
@testable import HarnessMobile

final class HeaderQuotePolicyTests: XCTestCase {
    func testLoadsSharedHomeHeaderQuotesContract() {
        let quotes = HeaderQuotePolicy.homeHeaderQuotes
        XCTAssertEqual(quotes.count, 5, "homeHeaderQuotes.json should load five quotes from the app bundle")
        XCTAssertFalse(quotes.contains(where: \.isEmpty))
    }

    func testHomeHeaderQuoteRotatesByUtcDay() {
        let quotes = HeaderQuotePolicy.homeHeaderQuotes
        let day0 = Date(timeIntervalSince1970: 0)
        let day1 = Date(timeIntervalSince1970: 86_400)
        XCTAssertEqual(HeaderQuotePolicy.pickHomeHeaderQuote(date: day0), quotes[0])
        XCTAssertEqual(HeaderQuotePolicy.pickHomeHeaderQuote(date: day1), quotes[1])
    }

    func testUsesNumberedListLinesFromNoteContent() {
        let content = """
        1. From my notes.
        2. Custom clipping quote.
        """
        let quote = HeaderQuotePolicy.headerQuote(fromNoteContent: content, rotationIndex: 0)
        XCTAssertEqual(quote, "From my notes.")
    }

    func testReturnsEmptyWhenNoNumberedLines() {
        let quote = HeaderQuotePolicy.headerQuote(fromNoteContent: "Plain paragraph.", rotationIndex: 0)
        XCTAssertEqual(quote, "")
    }

    func testReturnsEmptyWhenNoteIsEmpty() {
        let quote = HeaderQuotePolicy.headerQuote(fromNoteContent: "", rotationIndex: 0)
        XCTAssertEqual(quote, "")
    }

    func testNormalizesWhitespaceInLineContent() {
        let formatted = HeaderQuotePolicy.formatForHeader("  Line one.\n\n  Line two.  ")
        XCTAssertEqual(formatted, "Line one. Line two.")
    }

    func testStripsInlineTagsForHeaderDisplay() {
        let content = "1. Waste no more time arguing. #quotes #stoicism"
        let quote = HeaderQuotePolicy.headerQuote(fromNoteContent: content, rotationIndex: 0)
        XCTAssertEqual(quote, "Waste no more time arguing.")
    }

    func testUsesRotationIndexAcrossLines() {
        let content = """
        1. One
        2. Two
        """
        let first = HeaderQuotePolicy.headerQuote(fromNoteContent: content, rotationIndex: 0)
        let second = HeaderQuotePolicy.headerQuote(fromNoteContent: content, rotationIndex: 1)
        XCTAssertEqual(first, "One")
        XCTAssertEqual(second, "Two")
    }
}
