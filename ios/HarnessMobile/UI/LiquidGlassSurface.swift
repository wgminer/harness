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

private struct ContinuousGlassShape: Shape {
    var cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = min(cornerRadius, rect.height / 2, rect.width / 2)
        return RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: rect)
    }
}

struct LiquidGlassSurface: ViewModifier {
    var cornerRadius: CGFloat
    var shadowOffsetY: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                ContinuousGlassShape(cornerRadius: cornerRadius)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        ContinuousGlassShape(cornerRadius: cornerRadius)
                            .stroke(
                                Color.primary.opacity(colorScheme == .dark ? 0.14 : 0.10),
                                lineWidth: 1
                            )
                    }
                    .overlay(alignment: .top) {
                        ContinuousGlassShape(cornerRadius: cornerRadius)
                            .stroke(
                                Color.white.opacity(colorScheme == .dark ? 0.12 : 0.35),
                                lineWidth: 1
                            )
                            .blur(radius: 0.5)
                            .mask {
                                LinearGradient(
                                    colors: [.white, .clear],
                                    startPoint: .top,
                                    endPoint: .center
                                )
                            }
                            .allowsHitTesting(false)
                    }
                    .shadow(
                        color: .black.opacity(colorScheme == .dark ? 0.35 : 0.14),
                        radius: 24,
                        y: shadowOffsetY
                    )
            }
    }
}

extension View {
    func liquidGlassSurface(cornerRadius: CGFloat, shadowOffsetY: CGFloat) -> some View {
        modifier(LiquidGlassSurface(cornerRadius: cornerRadius, shadowOffsetY: shadowOffsetY))
    }
}
