import SwiftUI

/// Joy Division "Unknown Pleasures"-style stacked ridgeline driven by live metering.
///
/// Performance notes: each row stores a precomputed displacement profile (noise × envelope).
/// Per-frame work is only scaling those samples and stroking thin occlusion bands — no
/// hashing/`pow`/`exp` in the draw loop. History mutates ~14 Hz; live level is a single CGFloat.
struct LiveAudioWaveformView: View {
    let samples: [CGFloat]
    var level: CGFloat? = nil
    var color: Color = .primary
    var width: CGFloat = 240
    var height: CGFloat = 320
    var rowCount: Int = 28
    var pointsPerRow: Int = 32
    var pushInterval: TimeInterval = 0.08
    var idleAmplitude: CGFloat = 0.03
    var idleThreshold: CGFloat = 0.035
    /// Peak height relative to row spacing — loud peaks should climb several rows.
    var peakRowMultiples: CGFloat = 4.8

    @State private var rows: [RidgeRow] = []
    @State private var pushSeed: UInt64 = 0xC0FF_EE00_D15C_AFE
    @State private var lastPushAt: TimeInterval = 0
    /// Latest mic level — cheap to update; does not rebuild row profiles.
    @State private var liveLevel: CGFloat = 0
    @State private var lastLiveUpdateAt: TimeInterval = 0

    private var effectiveLevel: CGFloat {
        level ?? samples.last ?? liveLevel
    }

    var body: some View {
        // Cap redraw rate; mic publishes ~12 Hz and 15 Hz paint is plenty.
        TimelineView(.animation(minimumInterval: 1.0 / 15.0, paused: false)) { timeline in
            Canvas { context, size in
                drawRidges(
                    context: context,
                    size: size,
                    live: liveLevel,
                    now: timeline.date.timeIntervalSinceReferenceDate
                )
            }
        }
        .frame(width: width, height: height)
        // Rasterize once per frame — much cheaper than compositing many vector fills.
        .drawingGroup(opaque: false)
        .accessibilityLabel("Live audio level")
        .accessibilityValue(accessibilityLevelDescription)
        .onAppear {
            seedRowsIfNeeded()
            liveLevel = effectiveLevel
        }
        .onChange(of: samples) { _, newSamples in
            ingest(level: level ?? newSamples.last ?? 0)
        }
        .onChange(of: level) { _, newLevel in
            guard let newLevel else { return }
            ingest(level: newLevel)
        }
    }

    // MARK: - Metering ingest

    private func ingest(level raw: CGFloat) {
        let now = Date().timeIntervalSinceReferenceDate
        // Throttle live-level state writes; TimelineView still paints at 24 Hz.
        if now - lastLiveUpdateAt >= 1.0 / 30.0 {
            lastLiveUpdateAt = now
            liveLevel = raw
        }
        pushRowIfNeeded(level: raw, at: now)
    }

    // MARK: - History

    private func seedRowsIfNeeded() {
        guard rows.count != rowCount else { return }
        let count = max(pointsPerRow, 8)
        rows = (0 ..< rowCount).map { index in
            let seed = UInt64(index &+ 1) &* 0x9E37_79B9_7F4A_7C15
            return RidgeRow(
                level: idleAmplitude * (0.4 + 0.6 * CGFloat((index % 5)) / 4),
                profile: Self.makeProfile(seed: seed, pointCount: count)
            )
        }
    }

    private func pushRowIfNeeded(level raw: CGFloat, at now: TimeInterval) {
        if rows.count != rowCount {
            seedRowsIfNeeded()
        }
        guard now - lastPushAt >= pushInterval else { return }
        lastPushAt = now

        let amplitude = displayAmplitude(for: raw, at: now)
        pushSeed = pushSeed &* 0xBF58_476D_1CE4_E5B9 &+ 0x9E37_79B9_7F4A_7C15
        let count = max(pointsPerRow, 8)
        var next = rows
        if !next.isEmpty {
            next.removeFirst()
        }
        next.append(
            RidgeRow(
                level: amplitude,
                profile: Self.makeProfile(seed: pushSeed, pointCount: count)
            )
        )
        while next.count < rowCount {
            pushSeed = pushSeed &* 0x94D0_49BB_1331_11EB &+ 1
            next.insert(
                RidgeRow(
                    level: idleAmplitude,
                    profile: Self.makeProfile(seed: pushSeed, pointCount: count)
                ),
                at: 0
            )
        }
        if next.count > rowCount {
            next = Array(next.suffix(rowCount))
        }
        rows = next
    }

    /// Boost quiet speech and keep silence nearly flat.
    private func displayAmplitude(for raw: CGFloat, at now: TimeInterval) -> CGFloat {
        let live = min(max(raw, 0), 1)
        if live < idleThreshold {
            let breath = CGFloat(sin(now * 1.4) * 0.5 + 0.5)
            return idleAmplitude * (0.5 + 0.5 * breath)
        }
        let boosted = pow(live, 0.55)
        return min(max(boosted, idleAmplitude), 1)
    }

    // MARK: - Drawing

    private func plotRect(in size: CGSize) -> CGRect {
        let insetX = size.width * 0.06
        let insetY = size.height * 0.08
        return CGRect(
            x: insetX,
            y: insetY,
            width: size.width - insetX * 2,
            height: size.height - insetY * 2
        )
    }

    private func drawRidges(
        context: GraphicsContext,
        size: CGSize,
        live: CGFloat,
        now: TimeInterval
    ) {
        guard rowCount > 1, !rows.isEmpty else { return }

        let plot = plotRect(in: size)
        let rowSpacing = plot.height / CGFloat(rowCount - 1)
        let peakScale = rowSpacing * peakRowMultiples
        let occlusion = Color(.systemBackground)
        let strokeStyle = StrokeStyle(lineWidth: 1.25, lineCap: .butt, lineJoin: .miter)
        let liveAmplitude = displayAmplitude(for: live, at: now)
        // Thin band under each ridge is enough for occlusion and far cheaper than full-height fills.
        let occludeDepth = peakScale + rowSpacing

        for (index, row) in rows.enumerated() {
            let baselineY = plot.minY + CGFloat(index) * rowSpacing
            let amplitude = (index == rows.count - 1) ? liveAmplitude : row.level
            let profile = row.profile
            let lastIndex = profile.count - 1
            guard lastIndex >= 1 else { continue }

            let invLast = 1 / CGFloat(lastIndex)
            let fillBottom = min(plot.maxY + 2, baselineY + occludeDepth)

            var fillPath = Path()
            var strokePath = Path()

            let x0 = plot.minX
            let y0 = baselineY - profile[0] * amplitude * peakScale
            fillPath.move(to: CGPoint(x: x0, y: fillBottom))
            fillPath.addLine(to: CGPoint(x: x0, y: y0))
            strokePath.move(to: CGPoint(x: x0, y: y0))

            for i in 1 ... lastIndex {
                let x = plot.minX + CGFloat(i) * invLast * plot.width
                let y = baselineY - profile[i] * amplitude * peakScale
                let point = CGPoint(x: x, y: y)
                fillPath.addLine(to: point)
                strokePath.addLine(to: point)
            }

            fillPath.addLine(to: CGPoint(x: plot.maxX, y: fillBottom))
            fillPath.closeSubpath()

            context.fill(fillPath, with: .color(occlusion))
            context.stroke(strokePath, with: .color(color), style: strokeStyle)
        }
    }

    // MARK: - Profile generation (once per row, not per frame)

    /// Normalized displacement samples in ~0...1.55 (envelope × jagged noise).
    /// Called only when a row is created (~14 Hz), never in the draw loop.
    private static func makeProfile(seed: UInt64, pointCount: Int) -> [CGFloat] {
        var profile = [CGFloat]()
        profile.reserveCapacity(pointCount + 1)
        let sigma: CGFloat = 0.30
        let twoSigmaSq = 2 * sigma * sigma
        for i in 0 ... pointCount {
            let t = CGFloat(i) / CGFloat(pointCount)
            let centered = (t - 0.5) * 2
            let envelope = 0.02 + 0.98 * exp(-(centered * centered) / twoSigmaSq)
            profile.append(envelope * jaggedNoise(t: t, seed: seed))
        }
        return profile
    }

    /// Coarse + fine seeded value noise for asymmetric spiky peaks.
    private static func jaggedNoise(t: CGFloat, seed: UInt64) -> CGFloat {
        let coarse = valueNoise(t: t * 8.5, seed: seed, smooth: false)
        let mid = valueNoise(t: t * 16 + 0.21, seed: seed &+ 0xA5A5_A5A5_5A5A_5A5A, smooth: false)
        let fine = valueNoise(t: t * 28 + 0.37, seed: seed &+ 0xD1B5_4A32_D192_ED03, smooth: false)
        let spike = valueNoise(t: t * 4.2 + 1.1, seed: seed &+ 0x94D0_49BB_1331_11EB, smooth: true)
        let shaped =
            pow(coarse, 1.35) * 0.35
            + mid * 0.2
            + fine * 0.15
            + pow(max(spike, 0), 2.4) * 0.85
        return max(0.02, min(shaped, 1.55))
    }

    private static func valueNoise(t: CGFloat, seed: UInt64, smooth: Bool) -> CGFloat {
        let i0 = floor(t)
        let i1 = i0 + 1
        let f = t - i0
        let u = smooth ? f * f * (3 - 2 * f) : f
        let a = hash01(seed, Int(i0))
        let b = hash01(seed, Int(i1))
        return a + (b - a) * u
    }

    private static func hash01(_ seed: UInt64, _ index: Int) -> CGFloat {
        var z = seed &+ UInt64(bitPattern: Int64(index)) &* 0x9E37_79B9_7F4A_7C15
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z = z ^ (z >> 31)
        let unit = Double(z >> 11) / Double(1 << 53)
        return CGFloat(unit)
    }

    private var accessibilityLevelDescription: String {
        if effectiveLevel < idleThreshold { return "Silent" }
        if effectiveLevel < 0.35 { return "Quiet" }
        if effectiveLevel < 0.7 { return "Moderate" }
        return "Loud"
    }
}

private struct RidgeRow {
    var level: CGFloat
    /// Precomputed envelope × noise samples; scaled by `level` at draw time.
    var profile: [CGFloat]
}

#Preview("Silent") {
    LiveAudioWaveformView(samples: Array(repeating: 0, count: 32), level: 0)
        .padding(40)
}

#Preview("Quiet speech") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.08 + 0.22 * abs(sin(Double(index) / 3.2)))
        },
        level: 0.22
    )
    .padding(40)
}

#Preview("Loud peaks") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.25 + 0.7 * abs(sin(Double(index) / 2.4)))
        },
        level: 0.85
    )
    .padding(40)
}
