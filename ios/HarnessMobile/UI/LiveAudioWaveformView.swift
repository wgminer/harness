import SwiftUI

/// Circular audio blob driven by live metering samples (ported from `tmp/waveform-sandbox.html`).
struct LiveAudioWaveformView: View {
    let samples: [CGFloat]
    var level: CGFloat? = nil
    var color: Color = .red
    var diameter: CGFloat = 140
    var baseRadiusFraction: CGFloat = 0.41
    var ridgeStrength: CGFloat = 0.42
    var levelPulse: CGFloat = 0.28
    var idleBreathePeriod: TimeInterval = 1.1
    var idleThreshold: CGFloat = 0.04

    private var effectiveLevel: CGFloat {
        level ?? samples.last ?? 0
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            let breath = idleBreathAmplitude(at: timeline.date)
            let now = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                let mid = CGPoint(x: size.width / 2, y: size.height / 2)
                let base = min(size.width, size.height) * baseRadiusFraction
                let isIdle = effectiveLevel < idleThreshold
                let pulse: CGFloat = isIdle
                    ? 0.04 + breath * 0.06
                    : levelPulse * min(max(effectiveLevel, 0), 1)
                let ridges = ridgeLevels(count: 24)

                let glowPath = blobPath(
                    center: mid,
                    base: base * 1.18,
                    pulse: pulse,
                    ridges: ridges,
                    isIdle: isIdle,
                    breath: breath,
                    now: now
                )
                context.fill(glowPath, with: .color(color.opacity(0.18)))

                let corePath = blobPath(
                    center: mid,
                    base: base,
                    pulse: pulse,
                    ridges: ridges,
                    isIdle: isIdle,
                    breath: breath,
                    now: now
                )
                context.fill(
                    corePath,
                    with: .color(color.opacity(isIdle ? 0.55 : 0.92))
                )
            }
        }
        .frame(width: diameter, height: diameter)
        // Soft presence similar to the HTML glow layer.
        .shadow(color: color.opacity(0.35), radius: 18, y: 2)
        .accessibilityLabel("Live audio level")
        .accessibilityValue(accessibilityLevelDescription)
    }

    private func blobPath(
        center: CGPoint,
        base: CGFloat,
        pulse: CGFloat,
        ridges: [CGFloat],
        isIdle: Bool,
        breath: CGFloat,
        now: TimeInterval
    ) -> Path {
        let points = 64
        var path = Path()
        for i in 0 ... points {
            let ang = (CGFloat(i) / CGFloat(points)) * 2 * .pi - .pi / 2
            let ridge = ridges[i % ridges.count]
            let warp: CGFloat
            if isIdle {
                warp = sin(ang * 3 + CGFloat(now / 0.7)) * 0.025 * breath
            } else {
                warp = ridge * ridgeStrength * (0.55 + 0.45 * sin(ang * 5 + CGFloat(now / 0.18)))
            }
            let r = base * (1 + pulse + warp)
            let x = center.x + cos(ang) * r
            let y = center.y + sin(ang) * r
            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        path.closeSubpath()
        return path
    }

    private func ridgeLevels(count: Int) -> [CGFloat] {
        guard !samples.isEmpty else { return Array(repeating: 0, count: count) }
        var out: [CGFloat] = []
        out.reserveCapacity(count)
        for i in 0 ..< count {
            let src = Int((CGFloat(i) / CGFloat(count)) * CGFloat(samples.count)) % samples.count
            let next = (src + 1) % samples.count
            out.append(samples[src] * 0.45 + samples[next] * 0.55)
        }
        return out
    }

    private func idleBreathAmplitude(at date: Date) -> CGFloat {
        let t = date.timeIntervalSinceReferenceDate
        return CGFloat((sin(t * 2 * .pi / idleBreathePeriod) + 1) / 2)
    }

    private var accessibilityLevelDescription: String {
        if effectiveLevel < idleThreshold { return "Silent" }
        if effectiveLevel < 0.35 { return "Quiet" }
        if effectiveLevel < 0.7 { return "Moderate" }
        return "Loud"
    }
}

#Preview("Silent") {
    LiveAudioWaveformView(samples: Array(repeating: 0, count: 32))
        .padding(40)
        .background(Color.black)
}

#Preview("Quiet speech") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.08 + 0.22 * abs(sin(Double(index) / 3.2)))
        },
        level: 0.22
    )
    .padding(40)
    .background(Color.black)
}

#Preview("Loud peaks") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.25 + 0.7 * abs(sin(Double(index) / 2.4)))
        },
        level: 0.85
    )
    .padding(40)
    .background(Color.black)
}
