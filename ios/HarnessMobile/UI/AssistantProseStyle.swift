import SwiftUI
import UIKit

/// Assistant message typography: the system face at body size, on desktop's 16/24 rhythm
/// (`--font-size-chat` / `--line-height-chat` in base.css). Scales with Dynamic Type.
enum AssistantProseStyle {
    /// Body size at default Dynamic Type (UIKit body = 17pt).
    static let sizeScale: CGFloat = 1
    /// Desktop's 24px line on 16px type.
    static let lineHeightMultiple: CGFloat = 24.0 / 16.0
    /// Absolute size at default Dynamic Type (UIKit body = 17pt); MarkdownUI scales via `@ScaledMetric`.
    static let basePointSize: CGFloat = 17 * sizeScale

    static func uiFont(ofSize pointSize: CGFloat) -> UIFont {
        .systemFont(ofSize: pointSize)
    }

    static func font(size: CGFloat) -> Font {
        Font(uiFont(ofSize: size))
    }

    static func lineSpacing(forPointSize pointSize: CGFloat) -> CGFloat {
        let font = uiFont(ofSize: pointSize)
        let targetLineHeight = pointSize * lineHeightMultiple
        return max(0, targetLineHeight - font.lineHeight)
    }

    /// MarkdownUI `relativeLineSpacing(.em(...))` factor at default Dynamic Type.
    static var lineSpacingEm: CGFloat {
        lineSpacing(forPointSize: basePointSize) / basePointSize
    }

    static var font: Font {
        font(size: preferredPointSize)
    }

    static var lineSpacing: CGFloat {
        lineSpacing(forPointSize: preferredPointSize)
    }

    private static var preferredPointSize: CGFloat {
        UIFont.preferredFont(forTextStyle: .body).pointSize * sizeScale
    }
}

extension View {
    /// Desktop-like size/line-height for assistant prose; tracks Dynamic Type.
    func assistantProseStyle() -> some View {
        modifier(AssistantProseModifier())
    }
}

private struct AssistantProseModifier: ViewModifier {
    @ScaledMetric(relativeTo: .body) private var pointSize = AssistantProseStyle.basePointSize

    func body(content: Content) -> some View {
        content
            .font(AssistantProseStyle.font(size: pointSize))
            .lineSpacing(AssistantProseStyle.lineSpacing(forPointSize: pointSize))
    }
}
