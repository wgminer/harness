import XCTest
@testable import HarnessMobile

final class HeaderQuotePolicyTests: XCTestCase {
    func testUsesTextClippingsWithoutTagFiltering() {
        let clippings = [
            ClippingItem(
                id: "1",
                kind: .text,
                content: "From my notes.",
                tags: ["research"],
                createdAt: 0,
                updatedAt: 0
            ),
            ClippingItem(
                id: "2",
                kind: .text,
                content: "Custom clipping quote.",
                tags: ["quotes"],
                createdAt: 0,
                updatedAt: 0
            ),
        ]
        let quote = HeaderQuotePolicy.headerQuote(
            clippings: clippings,
            rotationIndex: 0
        )
        XCTAssertEqual(quote, "From my notes.")
    }

    func testReturnsEmptyWhenNoClippings() {
        let quote = HeaderQuotePolicy.headerQuote(clippings: [], rotationIndex: 0)
        XCTAssertEqual(quote, "")
    }

    func testSkipsNonTextKinds() {
        let clippings = [
            ClippingItem(
                id: "1",
                kind: .url,
                content: "https://example.com",
                tags: ["links"],
                createdAt: 0,
                updatedAt: 0
            ),
        ]
        let quote = HeaderQuotePolicy.headerQuote(clippings: clippings, rotationIndex: 0)
        XCTAssertEqual(quote, "")
    }

    func testNormalizesWhitespaceInClippingContent() {
        let formatted = HeaderQuotePolicy.formatForHeader("  Line one.\n\n  Line two.  ")
        XCTAssertEqual(formatted, "Line one. Line two.")
    }

    func testUsesRotationIndexAcrossClippings() {
        let clippings = [
            ClippingItem(id: "1", kind: .text, content: "One", tags: [], createdAt: 0, updatedAt: 0),
            ClippingItem(id: "2", kind: .text, content: "Two", tags: [], createdAt: 0, updatedAt: 0),
        ]
        let first = HeaderQuotePolicy.headerQuote(clippings: clippings, rotationIndex: 0)
        let second = HeaderQuotePolicy.headerQuote(clippings: clippings, rotationIndex: 1)
        XCTAssertEqual(first, "One")
        XCTAssertEqual(second, "Two")
    }
}
