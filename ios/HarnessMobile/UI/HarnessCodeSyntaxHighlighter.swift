import Highlightr
import MarkdownUI
import SwiftUI
import UIKit

struct HarnessCodeSyntaxHighlighter: CodeSyntaxHighlighter {
    var isStreaming: Bool = false

    private static let highlightr: Highlightr? = {
        let engine = Highlightr()
        engine?.setTheme(to: "github-dark")
        return engine
    }()

    func highlightCode(_ content: String, language: String?) -> Text {
        let fallback = Text(verbatim: content).font(.system(.body, design: .monospaced))
        if isStreaming { return fallback }
        guard let language, !language.isEmpty else { return fallback }
        guard let highlighted = Self.highlightr?.highlight(content, as: language) else { return fallback }
        guard let attributed = try? AttributedString(highlighted, including: \.uiKit) else { return fallback }
        return Text(attributed)
    }
}

extension CodeSyntaxHighlighter where Self == HarnessCodeSyntaxHighlighter {
    static var harness: HarnessCodeSyntaxHighlighter { HarnessCodeSyntaxHighlighter() }
    static func harness(streaming: Bool) -> HarnessCodeSyntaxHighlighter {
        HarnessCodeSyntaxHighlighter(isStreaming: streaming)
    }
}
