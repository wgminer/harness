import SwiftUI
import UIKit

/// Assistant message typography: desktop's reply face, VT323 (`--font-family-chat` in base.css).
/// Desktop sets 21/24; the phone keeps the same proportions and scales with Dynamic Type.
enum AssistantProseStyle {
    /// PostScript name of the bundled face (`Resources/Fonts/VT323-Regular.ttf`).
    static let fontName = "VT323-Regular"
    /// 21pt at default Dynamic Type (UIKit body = 17pt).
    static let sizeScale: CGFloat = 21.0 / 17.0
    /// Desktop's 24px line on 21px type.
    static let lineHeightMultiple: CGFloat = 24.0 / 21.0
    /// Absolute size at default Dynamic Type (UIKit body = 17pt); MarkdownUI scales via `@ScaledMetric`.
    static let basePointSize: CGFloat = 17 * sizeScale

    static func uiFont(ofSize pointSize: CGFloat) -> UIFont {
        UIFont(name: fontName, size: pointSize)
            ?? .monospacedSystemFont(ofSize: pointSize, weight: .regular)
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
    /// Desktop reply face + desktop-like size/line-height; tracks Dynamic Type.
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
