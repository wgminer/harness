import CoreHaptics
import SwiftUI
import UIKit

/// Directions for the recording visual. Exploration only: pick one and delete the rest.
enum CaptureVisualizerStyle: String, CaseIterable, Identifiable {
    case ridges
    case string
    case ring
    case dots

    static let storageKey = "dev.captureVisualizerStyle.v3"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ridges: return "Ridges"
        case .string: return "String"
        case .ring: return "Ring"
        case .dots: return "Dots"
        }
    }
}

/// The circle on the capture home. Idle it is the record button; recording, the ring visual
/// draws at the same size and place so the circle itself comes alive.
enum CaptureRing {
    static let radius: CGFloat = 78
    static let lineWidth: CGFloat = 3.5

    /// Offset from the safe-area center to the physical screen center.
    static func centerShift(_ insets: EdgeInsets) -> CGFloat {
        (insets.bottom - insets.top) / 2
    }
}

/// The recording visual in the chosen direction. Every direction is one white line weight on
/// the page background, moves with the voice, and answers a finger.
struct CaptureVisualizer: View {
    let recorder: AudioRecorder
    let style: CaptureVisualizerStyle
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if style == .ridges || reduceMotion {
            RidgelineWaveform(
                recorder: recorder,
                stroke: HarnessPalette.textStrong,
                occlusion: HarnessPalette.background
            )
            // A narrow, tall stack; it overflows the shared visual frame on purpose.
            .frame(width: 230, height: 470)
            // The ridgeline reserves headroom above its first row for tall peaks, which leaves
            // the stack sitting low; lift it so the rows themselves are centered.
            .offset(y: -40)
        } else {
            CaptureField(recorder: recorder, style: style, stroke: HarnessPalette.textStrong)
        }
    }
}

private struct CaptureField: UIViewRepresentable {
    let recorder: AudioRecorder
    let style: CaptureVisualizerStyle
    let stroke: Color

    func makeUIView(context: Context) -> CaptureFieldView {
        CaptureFieldView()
    }

    func updateUIView(_ view: CaptureFieldView, context: Context) {
        view.meterSource = recorder
        view.style = style
        view.strokeColor = UIColor(stroke)
    }
}

/// Core Graphics field with its own display link, like the ridgeline: the meter is sampled
/// per frame and never flows through SwiftUI state.
final class CaptureFieldView: UIView {
    weak var meterSource: AudioRecorder?
    var style: CaptureVisualizerStyle = .string {
        didSet {
            guard oldValue != style else { return }
            resetSimulation()
        }
    }
    var strokeColor: UIColor = .white

    private static let nodeCount = 96

    private var displayLink: CADisplayLink?
    private var lastTimestamp: TimeInterval = 0
    private var time: TimeInterval = 0
    /// Voice energy 0...1 above the room-noise floor; `slowEnergy` trails it for echoes.
    private var energy: CGFloat = 0
    private var slowEnergy: CGFloat = 0

    private var touchPoint: CGPoint?
    private var lastTouchPoint: CGPoint = .zero
    /// Eases 0...1 with the finger down, so releases relax instead of snapping.
    private var touchPull: CGFloat = 0

    private var displacement = [CGFloat](repeating: 0, count: CaptureFieldView.nodeCount)
    private var velocity = [CGFloat](repeating: 0, count: CaptureFieldView.nodeCount)

    private struct Ripple {
        var origin: CGPoint
        var born: TimeInterval
        var strength: CGFloat
        /// Per-ripple speed factor, so successive rings drift apart instead of marching in step.
        var pace: CGFloat
    }

    private let haptics = CaptureHaptics()
    /// Last stretch notch or grid cell that ticked, so a drag feels like detents, not a buzz.
    private var hapticStep = 0

    private var ripples: [Ripple] = []
    private var lastVoiceRippleAt: TimeInterval = 0
    /// Gap before the next voice ripple; redrawn each time so the cadence never settles.
    private var nextVoiceRippleGap: TimeInterval = 0.3
    /// Motion clocks that run faster with the voice, so loud passages churn and quiet ones drift.
    private var ringPhase: CGFloat = 0
    private var flowPhase: CGFloat = 0
    /// The string's visible amplitude: smoother than `energy`, so loudness reads as height.
    private var stringLevel: CGFloat = 0
    private var lastTouchRippleAt: TimeInterval = 0

    /// Resting dot positions, rebuilt only when the view size or spacing changes.
    private var dotLayout: (size: CGSize, spacing: CGFloat, points: [CGPoint]) = (.zero, 0, [])
    /// Lets one last frame draw the settled field before redraws pause in silence.
    private var drewAtRest = false
    private var drawnTuning = DotsTuning()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        isAccessibilityElement = true
        accessibilityLabel = "Live audio level"
        accessibilityTraits = .updatesFrequently
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        displayLink?.invalidate()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            guard displayLink == nil else { return }
            let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
            link.add(to: .main, forMode: .common)
            displayLink = link
        } else {
            displayLink?.invalidate()
            displayLink = nil
            lastTimestamp = 0
        }
    }

    private func resetSimulation() {
        displacement = [CGFloat](repeating: 0, count: Self.nodeCount)
        velocity = [CGFloat](repeating: 0, count: Self.nodeCount)
        ripples.removeAll()
        drewAtRest = false
    }

    @objc private func tick(_ link: CADisplayLink) {
        MainActor.assumeIsolated {
            let dt = lastTimestamp == 0 ? 1.0 / 60.0 : min(link.timestamp - lastTimestamp, 1.0 / 30.0)
            lastTimestamp = link.timestamp
            time += dt

            let target: CGFloat
            // Quick to rise, slow to fall, so syllables read as swells rather than flicker.
            var attack: CGFloat = 9
            var release: CGFloat = 3.5
            if style == .dots {
                let store = DotsTuningStore.shared
                let decibels = store.input(liveDecibels: meterSource?.currentMeterDecibels ?? -160, dt: dt)
                target = store.tuning.energy(forDecibels: decibels)
                attack = CGFloat(store.tuning.attack)
                release = CGFloat(store.tuning.release)
            } else {
                let level = meterSource?.currentMeterLevel ?? 0
                // Room noise sits near 0.08 and speech near 0.4+; lift speech off the floor.
                target = min(pow(max(0, (level - 0.1) / 0.9), 0.6), 1)
            }
            let rate = target > energy ? attack : release
            energy += (target - energy) * min(1, CGFloat(dt) * rate)
            slowEnergy += (energy - slowEnergy) * min(1, CGFloat(dt) * 2.5)
            touchPull += ((touchPoint == nil ? 0 : 1) - touchPull) * min(1, CGFloat(dt) * 9)
            ringPhase += CGFloat(dt) * (1.8 + 5 * energy)
            flowPhase += CGFloat(dt) * (0.9 + 3.2 * energy)
            let stringRate: CGFloat = target > stringLevel ? 5 : 1.8
            stringLevel += (target - stringLevel) * min(1, CGFloat(dt) * stringRate)

            switch style {
            case .string:
                stepString()
            case .dots:
                stepRipples()
            case .ring, .ridges:
                break
            }
            if style == .dots {
                DotsTuningStore.shared.lastEnergy = energy
                // A silent, untouched field does not change; skip the redraw until it does.
                let tuning = DotsTuningStore.shared.tuning
                let atRest = ripples.isEmpty && energy < 0.002 && touchPoint == nil
                if atRest, drewAtRest, tuning == drawnTuning { return }
                drewAtRest = atRest
                drawnTuning = tuning
            }
            setNeedsDisplay()
        }
    }

    // MARK: - Touch

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self) else { return }
        touchPoint = point
        lastTouchPoint = point
        hapticStep = dragStep(at: point)
        switch style {
        case .string:
            haptics.tick(intensity: 0.5, sharpness: 0.6)
        case .ring:
            haptics.tick(intensity: 0.4, sharpness: 0.3)
        case .dots:
            haptics.tick(intensity: 0.7, sharpness: 0.9)
        case .ridges:
            break
        }
        emitTouchRipple(at: point, strength: 0.9)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let point = touches.first?.location(in: self) else { return }
        touchPoint = point
        lastTouchPoint = point

        let step = dragStep(at: point)
        if step != hapticStep {
            hapticStep = step
            let strain = Float(dragStrain(at: point))
            switch style {
            case .string:
                // Tension notches: firmer and sharper the further the string is pulled.
                haptics.tick(intensity: 0.25 + 0.55 * strain, sharpness: 0.3 + 0.6 * strain)
            case .ring:
                haptics.tick(intensity: 0.2 + 0.4 * strain, sharpness: 0.15 + 0.35 * strain)
            case .dots:
                // One bump per dot the finger passes.
                haptics.tick(intensity: 0.35, sharpness: 0.8)
            case .ridges:
                break
            }
        }
        if time - lastTouchRippleAt > 0.11 {
            emitTouchRipple(at: point, strength: 0.55)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let strain = Float(dragStrain(at: lastTouchPoint))
        switch style {
        case .string where strain > 0.05:
            // The pluck: a snap, then a hum that dies away with the string.
            haptics.tick(intensity: 0.4 + 0.6 * strain, sharpness: 0.7)
            haptics.ring(intensity: 0.3 + 0.6 * strain, sharpness: 0.45, duration: 0.5 + 1.1 * Double(strain))
        case .ring where strain > 0.05:
            haptics.tick(intensity: 0.3 + 0.6 * strain, sharpness: 0.15)
        default:
            break
        }
        touchPoint = nil
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchPoint = nil
    }

    /// How far the finger has pulled the shape, 0...1.
    private func dragStrain(at point: CGPoint) -> CGFloat {
        switch style {
        case .string:
            return min(abs(point.y - bounds.midY) / max(bounds.height * 0.44, 1), 1)
        case .ring:
            let radius = CaptureRing.radius
            let distance = hypot(point.x - bounds.midX, point.y - bounds.midY)
            return min(abs(distance - radius) / max(radius * 0.8, 1), 1)
        case .dots, .ridges:
            return 0
        }
    }

    private func dragStep(at point: CGPoint) -> Int {
        switch style {
        case .string:
            return Int(abs(point.y - bounds.midY) / 14)
        case .ring:
            let radius = CaptureRing.radius
            return Int(abs(hypot(point.x - bounds.midX, point.y - bounds.midY) - radius) / 12)
        case .dots:
            let spacing = max(CGFloat(DotsTuningStore.shared.tuning.spacing), 1)
            return Int(point.x / spacing) &* 1000 &+ Int(point.y / spacing)
        case .ridges:
            return 0
        }
    }

    private func emitTouchRipple(at point: CGPoint, strength: CGFloat) {
        guard style == .dots else { return }
        lastTouchRippleAt = time
        ripples.append(Ripple(origin: point, born: time, strength: strength, pace: 1))
    }

    // MARK: - Simulation

    /// A taut string a finger can pin and pluck; the voice is drawn on top in `drawString`.
    private func stepString() {
        let n = Self.nodeCount
        let limit = bounds.height * 0.44
        let pinned = touchPoint.map { point -> (index: CGFloat, offset: CGFloat) in
            let inset = bounds.width * 0.08
            let unit = min(max((point.x - inset) / max(bounds.width - inset * 2, 1), 0), 1)
            return (unit * CGFloat(n - 1), min(max(point.y - bounds.midY, -limit), limit))
        }
        for _ in 0 ..< 6 {
            for i in 1 ..< n - 1 {
                let tension = 0.32 * (displacement[i - 1] - 2 * displacement[i] + displacement[i + 1])
                velocity[i] = (velocity[i] + tension) * 0.9965
            }
            for i in 1 ..< n - 1 {
                displacement[i] = min(max(displacement[i] + velocity[i], -limit), limit)
                if let pinned {
                    let distance = (CGFloat(i) - pinned.index) / 2.5
                    let grip = exp(-distance * distance)
                    displacement[i] += (pinned.offset - displacement[i]) * grip * 0.4
                    velocity[i] *= 1 - grip
                }
            }
        }
    }

    private func stepRipples() {
        let tuning = DotsTuningStore.shared.tuning
        ripples.removeAll { time - $0.born > tuning.rippleLife }
        // Speech is not a metronome: a rising syllable fires a ring early, and the gap, origin,
        // speed and strength of each ring vary a little so the field never settles into a pattern.
        let interval = tuning.rippleInterval
        let sinceLast = time - lastVoiceRippleAt
        let onset = energy - slowEnergy > 0.07 && sinceLast > interval * 0.45
        if energy > 0.1, onset || sinceLast > nextVoiceRippleGap {
            lastVoiceRippleAt = time
            nextVoiceRippleGap = interval * Double.random(in: 0.6 ... 1.7)
            let wander = CGFloat(tuning.spacing) * 0.9
            let origin = CGPoint(
                x: bounds.midX + CGFloat.random(in: -wander ... wander),
                y: bounds.midY + CGFloat.random(in: -wander ... wander)
            )
            let strength = energy * CGFloat(tuning.rippleGain) * CGFloat.random(in: 0.65 ... 1.15)
            ripples.append(
                Ripple(origin: origin, born: time, strength: strength, pace: CGFloat.random(in: 0.8 ... 1.2))
            )
        }
        if ripples.count > 16 {
            ripples.removeFirst(ripples.count - 16)
        }
    }

    // MARK: - Drawing

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let color = strokeColor.resolvedColor(with: traitCollection)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        switch style {
        case .string:
            drawString(in: context, color: color)
        case .ring:
            drawRing(in: context, color: color)
        case .dots:
            drawDots(in: context, color: color)
        case .ridges:
            break
        }
    }

    private func drawString(in context: CGContext, color: UIColor) {
        let n = Self.nodeCount
        let inset = bounds.width * 0.08
        let width = bounds.width - inset * 2
        let midY = bounds.midY
        // Height is the voice level, smoothed so it reads as loudness rather than flicker. The
        // shape is a few slow waves at unrelated rates, so it wanders instead of repeating.
        let voice = stringLevel * bounds.height * 0.3
        let p = flowPhase
        func point(_ i: Int) -> CGPoint {
            let x = CGFloat(i) / CGFloat(n - 1)
            let shape = 0.6 * sin(2 * .pi * x - p * 1.3)
                + 0.3 * sin(3.4 * .pi * x + p * 0.83 + 1.1)
                + 0.15 * sin(5.7 * .pi * x - p * 2.1 + 0.4)
            let wave = pow(sin(.pi * x), 1.4) * shape
            return CGPoint(x: inset + width * x, y: midY + displacement[i] + voice * wave)
        }

        context.beginPath()
        context.move(to: point(0))
        for i in 1 ..< n - 1 {
            let current = point(i)
            let next = point(i + 1)
            context.addQuadCurve(
                to: CGPoint(x: (current.x + next.x) / 2, y: (current.y + next.y) / 2),
                control: current
            )
        }
        context.addLine(to: point(n - 1))
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(1.5)
        context.strokePath()
    }

    private func drawRing(in context: CGContext, color: UIColor) {
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = CaptureRing.radius
        let toFinger = CGPoint(x: lastTouchPoint.x - center.x, y: lastTouchPoint.y - center.y)
        let fingerAngle = atan2(toFinger.y, toFinger.x)
        let fingerDistance = hypot(toFinger.x, toFinger.y)
        // The ring reaches for a finger outside it and dents under one inside it.
        let reach = touchPull * min(max(fingerDistance - radius, -radius * 0.5), radius * 0.8)

        func strokeRing(energy: CGFloat, phase: CGFloat, alpha: CGFloat) {
            let steps = 180
            context.beginPath()
            for step in 0 ... steps {
                let angle = CGFloat(step) / CGFloat(steps) * 2 * .pi
                var wobble: CGFloat = 0
                for k in 2 ... 6 {
                    let harmonic = CGFloat(k)
                    wobble += sin(harmonic * angle + phase * (0.6 + harmonic * 0.35) + harmonic * 1.7) / harmonic
                }
                // A fine, fast shiver on top of the slow wobble: the part that reads as vibrating.
                let shiver = sin(11 * angle - phase * 5) * 0.5 + sin(17 * angle + phase * 7) * 0.3
                var delta = angle - fingerAngle
                delta = atan2(sin(delta), cos(delta))
                let bump = reach * exp(-(delta * delta) / 0.3)
                let r = radius * (1 + energy * (0.06 + 0.22 * wobble + 0.035 * shiver)) + bump
                let p = CGPoint(x: center.x + cos(angle) * r, y: center.y + sin(angle) * r)
                if step == 0 {
                    context.move(to: p)
                } else {
                    context.addLine(to: p)
                }
            }
            context.closePath()
            context.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
            context.strokePath()
        }

        let t = ringPhase
        // Silent, it is exactly the idle circle; the echo only appears once there is a voice.
        context.setLineWidth(1)
        strokeRing(energy: slowEnergy * 1.5, phase: t - 0.9, alpha: 0.3 * min(1, slowEnergy * 3))
        context.setLineWidth(CaptureRing.lineWidth)
        strokeRing(energy: energy, phase: t, alpha: 1)
    }

    /// Dots on concentric rings, so the field is a disc and waves leave the center evenly.
    private func dotPoints(spacing: CGFloat) -> [CGPoint] {
        if dotLayout.size == bounds.size, dotLayout.spacing == spacing {
            return dotLayout.points
        }
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let ringCount = max(Int((min(bounds.width, bounds.height) / 2 - 8) / spacing), 1)
        var points: [CGPoint] = []
        for ring in 0 ... ringCount {
            let ringRadius = CGFloat(ring) * spacing
            let count = ring == 0 ? 1 : Int((2 * .pi * ringRadius / spacing).rounded())
            for index in 0 ..< count {
                let angle = CGFloat(index) / CGFloat(count) * 2 * .pi + CGFloat(ring) * 0.5
                points.append(CGPoint(x: center.x + cos(angle) * ringRadius, y: center.y + sin(angle) * ringRadius))
            }
        }
        dotLayout = (bounds.size, spacing, points)
        return points
    }

    private func drawDots(in context: CGContext, color: UIColor) {
        let tuning = DotsTuningStore.shared.tuning
        let spacing = max(CGFloat(tuning.spacing), 8)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let discRadius = max(min(bounds.width, bounds.height) / 2 - 8, 1)
        let speed = CGFloat(tuning.rippleSpeed)
        let width = max(CGFloat(tuning.rippleWidth), 1)
        let life = max(CGFloat(tuning.rippleLife), 0.1)
        let reach = max(CGFloat(tuning.directReach) * discRadius, 1)
        let swell = energy * CGFloat(tuning.direct)
        let dim = CGFloat(tuning.dimAlpha)
        let now = time
        // Age and fade are per ripple, not per dot.
        let waves = ripples.map { ripple -> (origin: CGPoint, front: CGFloat, strength: CGFloat) in
            let age = CGFloat(now - ripple.born)
            return (ripple.origin, age * speed * ripple.pace, ripple.strength * max(0, 1 - age / life))
        }
        let t = CGFloat(now)

        var red: CGFloat = 1, green: CGFloat = 1, blue: CGFloat = 1, alpha: CGFloat = 1
        color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

        for (index, rest) in dotPoints(spacing: spacing).enumerated() {
            // Each dot flickers on its own clock while there is a voice, so the swell is grainy
            // rather than a uniform glow.
            let seed = CGFloat(index)
            let rate = 2.4 + (seed * 0.618).truncatingRemainder(dividingBy: 1) * 4.2
            let flicker = 0.5 + 0.5 * sin(t * rate + seed * 2.399)
            var lift: CGFloat = energy * 0.3 * flicker * flicker
            var push = CGPoint.zero
            for wave in waves {
                let dx = rest.x - wave.origin.x
                let dy = rest.y - wave.origin.y
                let distance = max(hypot(dx, dy), 0.001)
                let offset = (distance - wave.front) / width
                let amount = wave.strength * exp(-offset * offset)
                lift += amount
                push.x += dx / distance * amount
                push.y += dy / distance * amount
            }
            if swell > 0 {
                let fromCenter = hypot(rest.x - center.x, rest.y - center.y) / reach
                lift += swell * exp(-fromCenter * fromCenter)
            }
            lift = min(lift, 1)
            let x = rest.x + push.x * CGFloat(tuning.push)
            let y = rest.y + push.y * CGFloat(tuning.push)
            let radius = CGFloat(tuning.dotSize) + CGFloat(tuning.dotGrow) * lift
            context.setFillColor(red: red, green: green, blue: blue, alpha: dim + (0.9 - dim) * lift)
            context.fillEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
        }
    }
}

/// Core Haptics for the capture visuals: short ticks and a decaying hum. Main thread only.
private final class CaptureHaptics {
    private var engine: CHHapticEngine?
    private var needsStart = true
    private let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    func tick(intensity: Float, sharpness: Float) {
        play(
            [CHHapticEvent(eventType: .hapticTransient, parameters: parameters(intensity, sharpness), relativeTime: 0)],
            curves: []
        )
    }

    func ring(intensity: Float, sharpness: Float, duration: TimeInterval) {
        let hum = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: parameters(intensity, sharpness),
            relativeTime: 0,
            duration: duration
        )
        let decay = CHHapticParameterCurve(
            parameterID: .hapticIntensityControl,
            controlPoints: [
                .init(relativeTime: 0, value: 1),
                .init(relativeTime: duration * 0.35, value: 0.35),
                .init(relativeTime: duration, value: 0),
            ],
            relativeTime: 0
        )
        play([hum], curves: [decay])
    }

    private func parameters(_ intensity: Float, _ sharpness: Float) -> [CHHapticEventParameter] {
        [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: min(max(intensity, 0), 1)),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: min(max(sharpness, 0), 1)),
        ]
    }

    private func play(_ events: [CHHapticEvent], curves: [CHHapticParameterCurve]) {
        guard supported else { return }
        do {
            if engine == nil {
                let created = try CHHapticEngine()
                created.playsHapticsOnly = true
                // The audio session starting or stopping can halt the engine; restart on next use.
                created.stoppedHandler = { [weak self] _ in
                    DispatchQueue.main.async { self?.needsStart = true }
                }
                created.resetHandler = { [weak self] in
                    DispatchQueue.main.async { self?.needsStart = true }
                }
                engine = created
            }
            guard let engine else { return }
            if needsStart {
                try engine.start()
                needsStart = false
            }
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            try engine.makePlayer(with: pattern).start(atTime: CHHapticTimeImmediate)
        } catch {
            needsStart = true
        }
    }
}

/// Swaps the recording visual; sits right of the stop control, mirroring discard on the left.
struct CaptureVisualizerMenu: View {
    @Binding var style: CaptureVisualizerStyle

    var body: some View {
        Menu {
            Picker("Visual", selection: $style) {
                ForEach(CaptureVisualizerStyle.allCases) { option in
                    Text(option.label).tag(option)
                }
            }
        } label: {
            Image(systemName: "circle.grid.2x2")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(HarnessPalette.textMuted)
                .frame(width: 56, height: 56)
                .background(Circle().fill(HarnessPalette.control))
        }
        .accessibilityLabel("Change visual")
    }
}
