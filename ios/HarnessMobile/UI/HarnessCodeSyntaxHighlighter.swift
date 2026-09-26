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
        // No explicit font: the theme's code block style sets SF Mono at the right size.
        let fallback = Text(verbatim: content)
        if isStreaming { return fallback }
        guard let language, !language.isEmpty else { return fallback }

        Self.lock.lock()
        defer { Self.lock.unlock() }
        let themeName = colorScheme == .dark ? "github-dark" : "github"
        Self.highlightr?.setTheme(to: themeName)
        guard let highlighted = Self.highlightr?.highlight(content, as: language) else { return fallback }
        // Carry token colors only. Highlightr's attributes also pin Courier and a theme
        // background, which would override the theme's SF Mono size and the code well.
        var attributed = AttributedString(highlighted.string)
        highlighted.enumerateAttribute(
            .foregroundColor,
            in: NSRange(location: 0, length: highlighted.length)
        ) { value, range, _ in
            guard let color = value as? UIColor,
                  let swiftRange = Range(range, in: attributed)
            else { return }
            attributed[swiftRange].foregroundColor = Color(color)
        }
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
