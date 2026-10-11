import XCTest
@testable import HarnessMobile

final class ChatDisplayTextTests: XCTestCase {
    /// Same cases as `src/shared/fixtures/layoutDirectives.json`.
    func testStripLayoutDirectivesMatchesDesktopFixtures() {
        let cases: [(String, String, String)] = [
            ("plain text is untouched", "Meet at 3:30pm.\n\n- one\n- two", "Meet at 3:30pm.\n\n- one\n- two"),
            ("callout keeps its body as a paragraph", "Before.\n:::tip\nShort suggestion.\n:::\nAfter.", "Before.\n\nShort suggestion.\n\nAfter."),
            ("details keeps its summary", ":::details{summary=\"Sources\"}\nLong content.\n:::", "**Sources**\n\nLong content."),
            ("chip becomes its label", "Build is :chip[failing]{tone=danger} and :chip[slow].", "Build is failing and slow."),
            ("link card becomes a markdown link", "See:\n\n:::link{url=\"https://example.com\" title=\"Example\" desc=\"One-line summary.\" site=\"example.com\"}\n:::", "See:\n\n[Example](https://example.com) — One-line summary."),
            ("code fences are left alone", "```md\n:::tip\nliteral :chip[x]\n:::\n```", "```md\n:::tip\nliteral :chip[x]\n:::\n```"),
            ("nested fence with more colons", "::::warning\nCareful.\n::::", "Careful."),
        ]
        for (name, input, output) in cases {
            XCTAssertEqual(ChatDisplayText.stripLayoutDirectives(input), output, name)
        }
    }

    func testStripQaOptionsHidesChoiceFence() {
        let input = "Which matters most?\n\n::::options\n:::option{title=\"Speed\"}\n:::\n:::option{title=\"Cost\"}\n:::\n::::"
        XCTAssertEqual(ChatDisplayText.forDisplay(input), "Which matters most?")
    }

    func testStripQaOptionsHidesPartialFenceWhileStreaming() {
        let input = "Which matters most?\n\n::::options\n:::option{title=\"Speed\"}"
        XCTAssertEqual(ChatDisplayText.forDisplay(input), "Which matters most?")
    }
}
