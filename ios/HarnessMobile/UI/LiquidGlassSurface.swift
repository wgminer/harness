import SwiftUI

enum BottomBarMetrics {
    static let horizontalInset: CGFloat = 24
    static let bottomInset: CGFloat = 12
    static let reservedHeight: CGFloat = 92
    static let collapsedInnerHorizontal: CGFloat = 22
    static let collapsedInnerVertical: CGFloat = 20
    static let expandedCornerRadius: CGFloat = 20
    /// Large radius clamped to half-height so the shape reads as a capsule.
    static let collapsedCornerRadius: CGFloat = 999
}

private struct ContinuousGlassShape: InsettableShape {
    var insetAmount: CGFloat = 0
    var cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        let inset = rect.insetBy(dx: insetAmount, dy: insetAmount)
        let radius = max(0, min(cornerRadius, rect.height / 2, rect.width / 2) - insetAmount)
        return RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: inset)
    }

    func inset(by amount: CGFloat) -> some InsettableShape {
        var shape = self
        shape.insetAmount += amount
        return shape
    }
}

/// Floating bottom-bar surface: desktop composer box (page-dark fill, hairline edge)
/// with a light blur so scrolled content reads as underneath.
struct LiquidGlassSurface: ViewModifier {
    var cornerRadius: CGFloat
    var shadowOffsetY: CGFloat

    func body(content: Content) -> some View {
        content
            .background {
                ContinuousGlassShape(cornerRadius: cornerRadius)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        ContinuousGlassShape(cornerRadius: cornerRadius)
                            .fill(HarnessPalette.surface.opacity(0.88))
                    }
                    .overlay {
                        ContinuousGlassShape(cornerRadius: cornerRadius)
                            .strokeBorder(HarnessPalette.hairline, lineWidth: 1)
                    }
                    .shadow(color: .black.opacity(0.35), radius: 12, y: shadowOffsetY)
            }
    }
}

extension View {
    func liquidGlassSurface(cornerRadius: CGFloat, shadowOffsetY: CGFloat) -> some View {
        modifier(LiquidGlassSurface(cornerRadius: cornerRadius, shadowOffsetY: shadowOffsetY))
    }
}
