import SwiftUI
import UIKit

/// Assistant message typography: desktop's serif voice, tuned for a phone measure.
/// Desktop sets 18/28 over ~65 characters; a phone line holds ~35, so the size steps
/// down slightly and leading tightens to keep lines reading as one paragraph.
enum AssistantProseStyle {
    /// 18pt at default Dynamic Type (UIKit body = 17pt).
    static let sizeScale: CGFloat = 18.0 / 17.0
    /// ~1.45 line height: open enough for serif, tight enough for short lines.
    static let lineHeightMultiple: CGFloat = 1.45
    /// Absolute size at default Dynamic Type (UIKit body = 17pt); MarkdownUI scales via `@ScaledMetric`.
    static let basePointSize: CGFloat = 17 * sizeScale

    static func uiFont(ofSize pointSize: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: pointSize, weight: .regular)
        guard let descriptor = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: descriptor, size: pointSize)
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
        .system(size: preferredPointSize, weight: .regular, design: .serif)
    }

    static var lineSpacing: CGFloat {
        lineSpacing(forPointSize: preferredPointSize)
    }

    private static var preferredPointSize: CGFloat {
        UIFont.preferredFont(forTextStyle: .body).pointSize * sizeScale
    }
}

extension View {
    /// System serif + desktop-like size/line-height; tracks Dynamic Type.
    func assistantProseStyle() -> some View {
        modifier(AssistantProseModifier())
    }
}

private struct AssistantProseModifier: ViewModifier {
    @ScaledMetric(relativeTo: .body) private var pointSize = AssistantProseStyle.basePointSize

    func body(content: Content) -> some View {
        content
            .font(.system(size: pointSize, weight: .regular, design: .serif))
            .lineSpacing(AssistantProseStyle.lineSpacing(forPointSize: pointSize))
    }
}
