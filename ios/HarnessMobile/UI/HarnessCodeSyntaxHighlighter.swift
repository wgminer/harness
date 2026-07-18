import Highlightr
import MarkdownUI
import SwiftUI
import UIKit

struct HarnessCodeSyntaxHighlighter: CodeSyntaxHighlighter {
    var isStreaming: Bool = false
    var colorScheme: ColorScheme = .dark

    private static let highlightr: Highlightr? = Highlightr()
    private static let lock = NSLock()

    func highlightCode(_ content: String, language: String?) -> Text {
        let fallback = Text(verbatim: content).font(.system(.body, design: .monospaced))
        if isStreaming { return fallback }
        guard let language, !language.isEmpty else { return fallback }

        Self.lock.lock()
        defer { Self.lock.unlock() }
        let themeName = colorScheme == .dark ? "github-dark" : "github"
        Self.highlightr?.setTheme(to: themeName)
        guard let highlighted = Self.highlightr?.highlight(content, as: language) else { return fallback }
        guard let attributed = try? AttributedString(highlighted, including: \.uiKit) else { return fallback }
        return Text(attributed)
    }
}

extension CodeSyntaxHighlighter where Self == HarnessCodeSyntaxHighlighter {
    static var harness: HarnessCodeSyntaxHighlighter { HarnessCodeSyntaxHighlighter() }
    static func harness(
        streaming: Bool,
        colorScheme: ColorScheme = .dark
    ) -> HarnessCodeSyntaxHighlighter {
        HarnessCodeSyntaxHighlighter(isStreaming: streaming, colorScheme: colorScheme)
    }
}
