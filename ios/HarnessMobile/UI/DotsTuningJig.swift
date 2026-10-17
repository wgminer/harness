import SwiftUI
import UIKit

/// Every knob behind the dots visual. Exploration only: once the values are settled, bake
/// them in as the defaults here and delete `DotsTuningJig` and `DotsTuningStore`.
struct DotsTuning: Codable, Equatable {
    /// Meter level (dBFS) that reads as silence, and the level that reads as full.
    var floorDb: Double = -48
    var ceilingDb: Double = -14
    /// Below 1 lifts quiet speech; above 1 holds the field still until the voice is loud.
    var curve: Double = 0.75
    /// How fast energy rises and falls, per second.
    var attack: Double = 9
    var release: Double = 3.5
    /// Immediate swell around the center, so a syllable shows before its ripple travels.
    var direct: Double = 0.35
    /// How far the swell reaches, as a fraction of the disc.
    var directReach: Double = 0.6
    var rippleGain: Double = 0.7
    var rippleInterval: Double = 0.34
    var rippleSpeed: Double = 200
    var rippleWidth: Double = 26
    var rippleLife: Double = 2.6
    var dotSize: Double = 1.1
    var dotGrow: Double = 2
    var dimAlpha: Double = 0.24
    var push: Double = 4
    var spacing: Double = 22

    func energy(forDecibels db: Float) -> CGFloat {
        let span = max(ceilingDb - floorDb, 1)
        let linear = min(max((Double(db) - floorDb) / span, 0), 1)
        return CGFloat(pow(linear, curve))
    }
}

/// Live tuning values plus a recorded level trace that can stand in for the microphone,
/// so a change can be judged against the same input every time. Main thread only.
final class DotsTuningStore: ObservableObject {
    static let shared = DotsTuningStore()
    static let traceSeconds: Double = 8

    private static let tuningKey = "dev.dotsTuning.v1"
    private static let traceKey = "dev.dotsTuningTrace.v1"

    @Published var tuning: DotsTuning {
        didSet {
            guard tuning != oldValue, let data = try? JSONEncoder().encode(tuning) else { return }
            UserDefaults.standard.set(data, forKey: Self.tuningKey)
        }
    }
    @Published private(set) var isCapturingTrace = false
    @Published var isLooping = false
    @Published private(set) var hasTrace: Bool

    /// Last frame's input and result, for the jig readout. Not published: read on a timer.
    private(set) var lastDecibels: Float = -160
    var lastEnergy: CGFloat = 0

    private var trace: [Float]
    private var traceElapsed: TimeInterval = 0
    private var loopIndex = 0

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.tuningKey),
           let saved = try? JSONDecoder().decode(DotsTuning.self, from: data) {
            tuning = saved
        } else {
            tuning = DotsTuning()
        }
        trace = (UserDefaults.standard.array(forKey: Self.traceKey) as? [NSNumber])?.map(\.floatValue) ?? []
        hasTrace = !trace.isEmpty
    }

    func reset() {
        tuning = DotsTuning()
    }

    func captureTrace() {
        trace = []
        traceElapsed = 0
        isLooping = false
        isCapturingTrace = true
    }

    /// Called once per display frame with the live meter; returns the level to draw.
    func input(liveDecibels: Float, dt: TimeInterval) -> Float {
        var db = liveDecibels
        if isCapturingTrace {
            trace.append(liveDecibels)
            traceElapsed += dt
            if traceElapsed >= Self.traceSeconds {
                isCapturingTrace = false
                hasTrace = true
                isLooping = true
                loopIndex = 0
                UserDefaults.standard.set(trace.map { NSNumber(value: $0) }, forKey: Self.traceKey)
            }
        } else if isLooping, !trace.isEmpty {
            db = trace[loopIndex % trace.count]
            loopIndex += 1
        }
        lastDecibels = db
        return db
    }
}

/// Tuning jig for the dots visual: a small tag on the middle of the right edge that opens a
/// panel of sliders. Self-contained so it is easy to remove.
struct DotsTuningJig: View {
    @Binding var isOpen: Bool
    @ObservedObject private var store = DotsTuningStore.shared
    @State private var copied = false

    static let panelHeight: CGFloat = 300

    var body: some View {
        ZStack {
            if !isOpen {
                tag
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            }
            if isOpen {
                panel
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: isOpen)
    }

    private var tag: some View {
        Button {
            isOpen = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(HarnessPalette.textMuted)
                .frame(width: 30, height: 44)
                .background(
                    UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10)
                        .fill(HarnessPalette.control)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Tune dots")
    }

    private var panel: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 2) {
                    group("Input")
                    row("Floor", \.floorDb, -75 ... -25, unit: "dB")
                    row("Ceiling", \.ceilingDb, -35 ... 0, unit: "dB")
                    row("Curve", \.curve, 0.2 ... 2.5)
                    row("Attack", \.attack, 1 ... 40)
                    row("Release", \.release, 0.5 ... 20)
                    group("Swell")
                    row("Amount", \.direct, 0 ... 1.5)
                    row("Reach", \.directReach, 0.1 ... 1.5)
                    group("Ripples")
                    row("Strength", \.rippleGain, 0 ... 2)
                    row("Every", \.rippleInterval, 0.04 ... 0.8, unit: "s")
                    row("Speed", \.rippleSpeed, 40 ... 700)
                    row("Width", \.rippleWidth, 6 ... 90)
                    row("Life", \.rippleLife, 0.4 ... 5, unit: "s")
                    group("Dots")
                    row("Size", \.dotSize, 0.4 ... 4)
                    row("Grow", \.dotGrow, 0 ... 8)
                    row("Dim", \.dimAlpha, 0 ... 0.8)
                    row("Push", \.push, 0 ... 16)
                    row("Spacing", \.spacing, 12 ... 40)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
        }
        .frame(height: Self.panelHeight)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16)
                .fill(HarnessPalette.surface)
        )
    }

    private var header: some View {
        HStack(spacing: 14) {
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                Text(String(format: "%.0f dB  %.2f", store.lastDecibels, Double(store.lastEnergy)))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(HarnessPalette.textMuted)
            }
            Spacer()
            Button(store.isCapturingTrace ? "Listening…" : "Sample") {
                store.captureTrace()
            }
            .disabled(store.isCapturingTrace)
            Button(store.isLooping ? "Live" : "Loop") {
                store.isLooping.toggle()
            }
            .disabled(!store.hasTrace || store.isCapturingTrace)
            Button("Reset") { store.reset() }
            Button(copied ? "Copied" : "Copy") { copyValues() }
            Button {
                isOpen = false
            } label: {
                Image(systemName: "chevron.down")
            }
            .accessibilityLabel("Close tuning")
        }
        .font(.footnote.weight(.medium))
        .tint(HarnessPalette.text)
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    private func group(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(HarnessPalette.textFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 10)
    }

    private func row(
        _ label: String,
        _ keyPath: WritableKeyPath<DotsTuning, Double>,
        _ range: ClosedRange<Double>,
        unit: String = ""
    ) -> some View {
        let value = store.tuning[keyPath: keyPath]
        return HStack(spacing: 10) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(HarnessPalette.text)
                .frame(width: 62, alignment: .leading)
            Slider(
                value: Binding(
                    get: { store.tuning[keyPath: keyPath] },
                    set: { store.tuning[keyPath: keyPath] = $0 }
                ),
                in: range
            )
            Text(String(format: abs(value) >= 10 ? "%.0f%@" : "%.2f%@", value, unit))
                .font(.caption.monospacedDigit())
                .foregroundStyle(HarnessPalette.textMuted)
                .frame(width: 52, alignment: .trailing)
        }
        .frame(height: 32)
    }

    /// Puts the current values on the clipboard as JSON, to paste back as the new defaults.
    private func copyValues() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(store.tuning) else { return }
        UIPasteboard.general.string = String(data: data, encoding: .utf8)
        copied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            copied = false
        }
    }
}
