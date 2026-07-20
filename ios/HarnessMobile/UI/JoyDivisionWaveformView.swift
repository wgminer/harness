import UIKit

/// Joy Division ridgeline drawn with Core Graphics. Owns row history and a CADisplayLink
/// paint loop so SwiftUI never rebuilds paths or `@State` arrays on meter ticks.
final class JoyDivisionWaveformView: UIView {
    var level: CGFloat = 0
    var strokeColor: UIColor = .label {
        didSet { setNeedsDisplay() }
    }

    var rowCount: Int = 28
    var pointsPerRow: Int = 32
    /// Matches desktop `PUSH_INTERVAL_MS` (70).
    var pushInterval: TimeInterval = 0.07
    var idleAmplitude: CGFloat = 0.045
    /// Levels below this draw the idle breathing field. AudioRecorder levels are already
    /// normalized 0...1; ambient room noise lands ≈0.08, speech ≈0.4+.
    var idleThreshold: CGFloat = 0.1
    /// AudioRecorder already normalizes and smooths to 0...1 — no extra gain (desktop's
    /// LEVEL_GAIN=10 compensates for raw, tiny WebAudio levels; applying it here saturated
    /// every row to full height).
    var levelGain: CGFloat = 1
    var peakRowMultiples: CGFloat = 6.2

    private var rows: [RidgeRow] = []
    private var pushSeed: UInt64 = 0xC0FF_EE00_D15C_AFE
    private var lastPushAt: TimeInterval = 0
    private var lastFrameAt: TimeInterval = 0
    private var displayLink: CADisplayLink?
    /// Match desktop `FRAME_MS = 1000 / 24`.
    private let minFrameInterval: TimeInterval = 1.0 / 24.0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        isAccessibilityElement = true
        accessibilityLabel = "Live audio level"
        accessibilityTraits = .updatesFrequently
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: JoyDivisionWaveformView, _) in
            view.setNeedsDisplay()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        stopDisplayLink()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            seedRowsIfNeeded()
            startDisplayLink()
            setNeedsDisplay()
        } else {
            stopDisplayLink()
        }
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        drawRidges(in: context, size: bounds.size, now: CACurrentMediaTime())
    }

    // MARK: - Display link

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tickDisplayLink(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 20, maximum: 30, preferred: 24)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tickDisplayLink(_ link: CADisplayLink) {
        let now = link.timestamp
        if !UIAccessibility.isReduceMotionEnabled {
            pushRowIfNeeded(level: level, at: now)
        }
        guard now - lastFrameAt >= minFrameInterval else { return }
        lastFrameAt = now
        updateAccessibilityValue()
        setNeedsDisplay()
    }

    // MARK: - History

    private func seedRowsIfNeeded() {
        guard rows.count != rowCount else { return }
        let count = max(pointsPerRow, 8)
        rows = (0 ..< rowCount).map { index in
            let seed = UInt64(index &+ 1) &* 0x9E37_79B9_7F4A_7C15
            return RidgeRow(
                level: idleAmplitude * (0.4 + 0.6 * CGFloat(index % 5) / 4),
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

        if !rows.isEmpty {
            rows.removeFirst()
        }
        rows.append(
            RidgeRow(
                level: amplitude,
                profile: Self.makeProfile(seed: pushSeed, pointCount: count)
            )
        )
        while rows.count < rowCount {
            pushSeed = pushSeed &* 0x94D0_49BB_1331_11EB &+ 1
            rows.insert(
                RidgeRow(
                    level: idleAmplitude,
                    profile: Self.makeProfile(seed: pushSeed, pointCount: count)
                ),
                at: 0
            )
        }
        if rows.count > rowCount {
            rows.removeFirst(rows.count - rowCount)
        }
    }

    private func displayAmplitude(for raw: CGFloat, at now: TimeInterval) -> CGFloat {
        let boosted = min(max(raw, 0) * levelGain, 1)
        if boosted < idleThreshold {
            let breath = CGFloat(sin(now * 1.4) * 0.5 + 0.5)
            return idleAmplitude * (0.55 + 0.45 * breath)
        }
        return min(max(pow(boosted, 0.55), idleAmplitude), 1)
    }

    // MARK: - Drawing

    private func drawRidges(in context: CGContext, size: CGSize, now: TimeInterval) {
        guard rowCount > 1, !rows.isEmpty else { return }

        let insetX = size.width * 0.06
        let insetY = size.height * 0.08
        let plotMinX = insetX
        let plotMinY = insetY
        let plotWidth = size.width - insetX * 2
        let plotHeight = size.height - insetY * 2
        let plotMaxY = plotMinY + plotHeight

        // Profiles reach up to ~1.55 (jaggedNoise clamp). Reserve that much headroom above
        // the first baseline so tall peaks render inside the view instead of clipping at
        // the top edge.
        let maxProfileValue: CGFloat = 1.55
        let rowSpacing = plotHeight / (CGFloat(rowCount - 1) + peakRowMultiples * maxProfileValue)
        let peakScale = rowSpacing * peakRowMultiples
        let firstBaselineY = plotMinY + peakScale * maxProfileValue
        let occludeDepth = peakScale + rowSpacing
        let liveAmplitude = displayAmplitude(for: level, at: now)
        let occlusion = UIColor.systemBackground.cgColor
        let stroke = strokeColor.resolvedColor(with: traitCollection).cgColor

        context.setLineWidth(1.25)
        context.setLineCap(.butt)
        context.setLineJoin(.miter)

        for (index, row) in rows.enumerated() {
            let baselineY = firstBaselineY + CGFloat(index) * rowSpacing
            let amplitude = (index == rows.count - 1) ? liveAmplitude : row.level
            let profile = row.profile
            let lastIndex = profile.count - 1
            guard lastIndex >= 1 else { continue }

            let invLast = 1 / CGFloat(lastIndex)
            let fillBottom = min(plotMaxY + 2, baselineY + occludeDepth)
            let x0 = plotMinX
            let y0 = baselineY - profile[0] * amplitude * peakScale

            context.beginPath()
            context.move(to: CGPoint(x: x0, y: fillBottom))
            context.addLine(to: CGPoint(x: x0, y: y0))
            for i in 1 ... lastIndex {
                let x = plotMinX + CGFloat(i) * invLast * plotWidth
                let y = baselineY - profile[i] * amplitude * peakScale
                context.addLine(to: CGPoint(x: x, y: y))
            }
            context.addLine(to: CGPoint(x: plotMinX + plotWidth, y: fillBottom))
            context.closePath()
            context.setFillColor(occlusion)
            context.fillPath()

            context.beginPath()
            context.move(to: CGPoint(x: x0, y: y0))
            for i in 1 ... lastIndex {
                let x = plotMinX + CGFloat(i) * invLast * plotWidth
                let y = baselineY - profile[i] * amplitude * peakScale
                context.addLine(to: CGPoint(x: x, y: y))
            }
            context.setStrokeColor(stroke)
            context.strokePath()
        }
    }

    // MARK: - Profile generation (once per row, not per frame)

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

    private func updateAccessibilityValue() {
        let description: String
        // Compare raw meter (pre-gain) so thresholds stay speech-shaped for VoiceOver.
        if level < 0.035 {
            description = "Silent"
        } else if level < 0.35 {
            description = "Quiet"
        } else if level < 0.7 {
            description = "Moderate"
        } else {
            description = "Loud"
        }
        if accessibilityValue != description {
            accessibilityValue = description
        }
    }
}

private struct RidgeRow {
    var level: CGFloat
    /// Precomputed envelope × noise samples; scaled by `level` at draw time.
    var profile: [CGFloat]
}
