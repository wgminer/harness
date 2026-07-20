import XCTest
@testable import HarnessMobile

final class StreamingMarkdownBlocksTests: XCTestCase {
    func testEmpty() {
        let blocks = StreamingMarkdownBlocks.split("")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertEqual(blocks.trailing, "")
    }

    func testJoinEqualsOriginal() {
        let samples = [
            "Hello",
            "Hello **world**",
            "Para one\n\nPara two",
            "Para one\n\nPara two\n\nPara three partial",
            "- a\n- b\n\nNext",
            "Intro\n\n```swift\nlet x = 1\n```",
            "Intro\n\n```swift\nlet x = 1\n```\n\nOutro",
            "```\ncode\n",
            "# Heading\n\nBody",
            "Text with `code` and **bold**\n\nMore",
        ]
        for sample in samples {
            let blocks = StreamingMarkdownBlocks.split(sample)
            XCTAssertEqual(
                blocks.completed.joined() + blocks.trailing,
                sample,
                "join mismatch for: \(sample)"
            )
        }
    }

    func testSingleParagraphStaysTrailing() {
        let blocks = StreamingMarkdownBlocks.split("Hello world")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertEqual(blocks.trailing, "Hello world")
    }

    func testBlankLinePromotesPreviousWhenNextStarts() {
        let blocks = StreamingMarkdownBlocks.split("Para one\n\nPara two")
        XCTAssertEqual(blocks.completed, ["Para one\n\n"])
        XCTAssertEqual(blocks.trailing, "Para two")
    }

    func testListStaysOneBlockUntilBlankLine() {
        let blocks = StreamingMarkdownBlocks.split("- a\n- b\n- c")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertEqual(blocks.trailing, "- a\n- b\n- c")

        let split = StreamingMarkdownBlocks.split("- a\n- b\n\nAfter")
        XCTAssertEqual(split.completed, ["- a\n- b\n\n"])
        XCTAssertEqual(split.trailing, "After")
    }

    func testOpenFenceStaysTrailing() {
        let blocks = StreamingMarkdownBlocks.split("Intro\n\n```swift\nlet x = 1\n")
        XCTAssertEqual(blocks.completed, ["Intro\n\n"])
        XCTAssertEqual(blocks.trailing, "```swift\nlet x = 1\n")
        XCTAssertFalse(StreamingMarkdownBlocks.isClosedFenceBlock(blocks.trailing))
    }

    func testClosedFencePromotes() {
        let blocks = StreamingMarkdownBlocks.split("Intro\n\n```swift\nlet x = 1\n```")
        XCTAssertEqual(blocks.completed, ["Intro\n\n", "```swift\nlet x = 1\n```"])
        XCTAssertEqual(blocks.trailing, "")
    }

    func testClosedFenceThenMore() {
        let blocks = StreamingMarkdownBlocks.split("Intro\n\n```swift\nlet x = 1\n```\n\nOutro")
        XCTAssertEqual(blocks.completed.count, 2)
        XCTAssertEqual(blocks.completed[0], "Intro\n\n")
        XCTAssertTrue(blocks.completed[1].hasPrefix("```swift"))
        XCTAssertEqual(blocks.trailing, "Outro")
    }

    func testIncompleteBoldStaysTrailing() {
        let blocks = StreamingMarkdownBlocks.split("Hello **wor")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertEqual(blocks.trailing, "Hello **wor")
        XCTAssertTrue(StreamingMarkdownBlocks.hasUnbalancedInlineMarkers(blocks.trailing))
    }

    func testIncompleteBoldPulledBackAcrossBlankLine() {
        let blocks = StreamingMarkdownBlocks.split("Hello **wor\n\nNext")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertEqual(blocks.trailing, "Hello **wor\n\nNext")
    }

    func testBalancedBoldCanComplete() {
        let blocks = StreamingMarkdownBlocks.split("Hello **world**\n\nNext")
        XCTAssertEqual(blocks.completed, ["Hello **world**\n\n"])
        XCTAssertEqual(blocks.trailing, "Next")
    }

    func testIncompleteInlineBacktickStaysTrailing() {
        let blocks = StreamingMarkdownBlocks.split("Use `code")
        XCTAssertEqual(blocks.completed, [])
        XCTAssertTrue(StreamingMarkdownBlocks.hasUnbalancedInlineMarkers(blocks.trailing))
    }

    func testBlankLinesInsideOpenFenceDoNotSplit() {
        let content = "Before\n\n```\nline1\n\nline2\n"
        let blocks = StreamingMarkdownBlocks.split(content)
        XCTAssertEqual(blocks.completed, ["Before\n\n"])
        XCTAssertEqual(blocks.trailing, "```\nline1\n\nline2\n")
        XCTAssertEqual(blocks.completed.joined() + blocks.trailing, content)
    }

    func testSoleClosedFencePromotes() {
        let blocks = StreamingMarkdownBlocks.split("```\ncode\n```")
        XCTAssertEqual(blocks.completed, ["```\ncode\n```"])
        XCTAssertEqual(blocks.trailing, "")
    }
}
