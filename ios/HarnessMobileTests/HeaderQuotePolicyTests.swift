import XCTest
@testable import HarnessMobile

final class HeaderQuotePolicyTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "HeaderQuotePolicyTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testLoadsSharedHomeHeaderQuotesContract() {
        let quotes = HeaderQuotePolicy.homeHeaderQuotes
        XCTAssertGreaterThanOrEqual(quotes.count, 20, "homeHeaderQuotes.json should load ~24 quotes from the app bundle")
        XCTAssertLessThanOrEqual(quotes.count, 30)
        XCTAssertFalse(quotes.contains(where: { $0.short.isEmpty }))
        for quote in quotes {
            XCTAssertLessThanOrEqual(quote.short.count, 32)
            XCTAssertTrue(quote.full.contains(quote.short), "full must contain short for \(quote.id)")
            XCTAssertFalse(quote.id.isEmpty)
            XCTAssertFalse(quote.author.isEmpty)
            XCTAssertFalse(quote.source.isEmpty)
            XCTAssertFalse(quote.context.isEmpty)
            XCTAssertFalse(quote.moral.isEmpty)
        }
    }

    func testShuffleBagDoesNotRepeatUntilExhausted() {
        let quotes = HeaderQuotePolicy.homeHeaderQuotes
        XCTAssertFalse(quotes.isEmpty)

        var seen = Set<String>()
        let random: (Int) -> Int = { _ in 0 }
        for _ in 0..<quotes.count {
            let next = HeaderQuotePolicy.nextHomeHeaderQuote(defaults: defaults, random: random)
            XCTAssertFalse(seen.contains(next.id), "unexpected repeat of \(next.id)")
            seen.insert(next.id)
        }
        XCTAssertEqual(seen.count, quotes.count)

        let afterReshuffle = HeaderQuotePolicy.nextHomeHeaderQuote(defaults: defaults, random: random)
        XCTAssertTrue(quotes.contains(where: { $0.id == afterReshuffle.id }))
    }

    func testPersistsRemainingIdsAfterDraw() {
        defaults.set(["didion-stories", "orwell-windowpane"], forKey: HeaderQuotePolicy.homeHeaderQuoteBagKey)
        let first = HeaderQuotePolicy.nextHomeHeaderQuote(defaults: defaults, random: { _ in 0 })
        XCTAssertEqual(first.id, "didion-stories")
        XCTAssertEqual(
            defaults.array(forKey: HeaderQuotePolicy.homeHeaderQuoteBagKey) as? [String],
            ["orwell-windowpane"]
        )
        let second = HeaderQuotePolicy.nextHomeHeaderQuote(defaults: defaults, random: { _ in 0 })
        XCTAssertEqual(second.id, "orwell-windowpane")
        XCTAssertEqual(
            defaults.array(forKey: HeaderQuotePolicy.homeHeaderQuoteBagKey) as? [String],
            []
        )
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
