import SwiftUI

struct SpeakingIndicatorView: View {
    var level: CGFloat

    private static let viewSize: CGFloat = 260

    @State private var smoothedLevel: CGFloat = 0.06

    private var clampedLevel: CGFloat {
        min(max(level, 0), 1)
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            let drift = CGSize(
                width: CGFloat(sin(time * 1.1) * 11),
                height: CGFloat(cos(time * 0.88) * 14)
            )

            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)

                let auraPath = blobPath(
                    center: center,
                    baseRadius: 78 + smoothedLevel * 34,
                    time: time,
                    level: smoothedLevel,
                    seed: 0.0,
                    irregularity: 0.34 + Double(smoothedLevel) * 0.22
                )
                context.fill(
                    auraPath,
                    with: .radialGradient(
                        Gradient(colors: [
                            Color(red: 1.0, green: 0.22, blue: 0.2).opacity(0.82),
                            Color(red: 0.92, green: 0.08, blue: 0.12).opacity(0.62),
                            Color(red: 0.75, green: 0.02, blue: 0.08).opacity(0.38),
                        ]),
                        center: center,
                        startRadius: 0,
                        endRadius: 110 + smoothedLevel * 28
                    )
                )

                let bodyPath = blobPath(
                    center: center,
                    baseRadius: 48 + smoothedLevel * 26,
                    time: time * 1.18,
                    level: smoothedLevel,
                    seed: 1.7,
                    irregularity: 0.42 + Double(smoothedLevel) * 0.28
                )
                context.fill(
                    bodyPath,
                    with: .radialGradient(
                        Gradient(colors: [
                            Color(red: 1.0, green: 0.34, blue: 0.28),
                            Color(red: 0.95, green: 0.12, blue: 0.14),
                            Color(red: 0.82, green: 0.02, blue: 0.08),
                        ]),
                        center: CGPoint(x: center.x - 8, y: center.y - 10),
                        startRadius: 0,
                        endRadius: 72 + smoothedLevel * 22
                    )
                )

                let corePath = blobPath(
                    center: center,
                    baseRadius: 20 + smoothedLevel * 14,
                    time: time * 1.45,
                    level: smoothedLevel,
                    seed: 3.2,
                    irregularity: 0.28 + Double(smoothedLevel) * 0.18
                )
                context.fill(
                    corePath,
                    with: .radialGradient(
                        Gradient(colors: [
                            Color(red: 1.0, green: 0.72, blue: 0.66),
                            Color(red: 1.0, green: 0.38, blue: 0.32),
                            Color(red: 0.94, green: 0.14, blue: 0.16),
                        ]),
                        center: CGPoint(x: center.x + 6, y: center.y + 4),
                        startRadius: 0,
                        endRadius: 34 + smoothedLevel * 12
                    )
                )
            }
            .blur(radius: 0.8)
            .offset(drift)
            .scaleEffect(0.94 + smoothedLevel * 0.18 + 0.05 * sin(time * 2.4))
        }
        .frame(width: Self.viewSize, height: Self.viewSize)
        .onChange(of: level) { _, newLevel in
            let normalized = min(max(newLevel, 0), 1)
            withAnimation(.spring(response: 0.18, dampingFraction: 0.55)) {
                smoothedLevel = normalized
            }
        }
        .accessibilityLabel("Live audio level")
        .accessibilityValue(clampedLevel >= 0.12 ? "Speaking" : "Silent")
    }

    private func blobPath(
        center: CGPoint,
        baseRadius: CGFloat,
        time: TimeInterval,
        level: CGFloat,
        seed: Double,
        irregularity: Double
    ) -> Path {
        let pointCount = 72
        var points: [CGPoint] = []

        for index in 0..<pointCount {
            let angle = (CGFloat(index) / CGFloat(pointCount)) * (.pi * 2)
            let a = Double(angle) + seed

            let warp1 = sin(a * 2.0 + time * 2.3 + seed) * 0.16
            let warp2 = sin(a * 3.0 - time * 1.7 + seed * 1.4) * 0.12
            let warp3 = cos(a * 5.0 + time * 2.9 - seed * 0.6) * 0.09
            let warp4 = sin(a * 7.0 + time * 4.1) * 0.05
            let voiceWarp = Double(level) * sin(a * 4.0 + time * 5.6 + seed) * 0.2

            let radius = baseRadius * CGFloat(1.0 + (warp1 + warp2 + warp3 + warp4 + voiceWarp) * irregularity)
            points.append(
                CGPoint(
                    x: center.x + cos(angle) * radius,
                    y: center.y + sin(angle) * radius
                )
            )
        }

        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)

        for index in 1..<points.count {
            let previous = points[index - 1]
            let current = points[index]
            let midpoint = CGPoint(
                x: (previous.x + current.x) / 2,
                y: (previous.y + current.y) / 2
            )
            path.addQuadCurve(to: midpoint, control: previous)
        }

        if let last = points.last {
            path.addQuadCurve(to: first, control: last)
        }

        path.closeSubpath()
        return path
    }
}

#Preview("Speaking indicator") {
    VStack(spacing: 40) {
        SpeakingIndicatorView(level: 0.08)
        SpeakingIndicatorView(level: 0.55)

        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let simulated = 0.15 + 0.75 * (sin(t * 6.2) * 0.5 + 0.5)
            SpeakingIndicatorView(level: CGFloat(simulated))
        }
    }
    .padding()
    .background(Color.black.opacity(0.06))
}
