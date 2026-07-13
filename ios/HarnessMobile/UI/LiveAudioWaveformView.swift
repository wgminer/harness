import SwiftUI

struct LiveAudioWaveformView: View {
    let samples: [CGFloat]
    var barColor: Color = .red
    var maxBarHeight: CGFloat = 60
    var barSpacing: CGFloat = 2
    var idleThreshold: CGFloat = 0.04

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            let breath = idleBreathAmplitude(at: timeline.date)
            Canvas { context, size in
                let count = max(samples.count, 1)
                let totalSpacing = barSpacing * CGFloat(max(count - 1, 0))
                let barWidth = max(3, (size.width - totalSpacing) / CGFloat(count))
                let midY = size.height / 2
                let isIdle = (samples.last ?? 0) < idleThreshold

                for index in 0 ..< count {
                    let level = index < samples.count ? samples[index] : 0
                    let progress = count > 1 ? CGFloat(index) / CGFloat(count - 1) : 1
                    // Newest (trailing) bars strongest; older bars ease down.
                    let ageOpacity = 0.28 + (0.72 * progress)
                    let height: CGFloat
                    let opacity: Double

                    if isIdle {
                        height = 2.5 + breath * 2.5
                        opacity = Double(0.22 + breath * 0.18)
                    } else {
                        let clamped = min(max(level, 0), 1)
                        // Hairline for near-silence so the ribbon stays continuous.
                        height = max(2, clamped * maxBarHeight)
                        opacity = Double(ageOpacity)
                    }

                    let x = CGFloat(index) * (barWidth + barSpacing)
                    let rect = CGRect(
                        x: x,
                        y: midY - height / 2,
                        width: barWidth,
                        height: height
                    )
                    let path = Path(roundedRect: rect, cornerRadius: barWidth / 2)
                    context.fill(path, with: .color(barColor.opacity(opacity)))
                }
            }
        }
        .frame(height: maxBarHeight)
        .accessibilityLabel("Live audio level")
        .accessibilityValue(accessibilityLevelDescription)
    }

    private func idleBreathAmplitude(at date: Date) -> CGFloat {
        let t = date.timeIntervalSinceReferenceDate
        return CGFloat((sin(t * 2 * .pi / 1.1) + 1) / 2)
    }

    private var accessibilityLevelDescription: String {
        guard let latest = samples.last else { return "Silent" }
        if latest < idleThreshold { return "Silent" }
        if latest < 0.35 { return "Quiet" }
        if latest < 0.7 { return "Moderate" }
        return "Loud"
    }
}

#Preview("Silent") {
    LiveAudioWaveformView(samples: Array(repeating: 0, count: 32))
        .padding(.vertical, 24)
}

#Preview("Quiet speech") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.08 + 0.22 * abs(sin(Double(index) / 3.2)))
        }
    )
    .padding(.vertical, 24)
}

#Preview("Loud peaks") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            CGFloat(0.25 + 0.7 * abs(sin(Double(index) / 2.4)))
        }
    )
    .padding(.vertical, 24)
}

#Preview("Scrolling history") {
    LiveAudioWaveformView(
        samples: (0 ..< 32).map { index in
            let progress = Double(index) / 31.0
            return CGFloat(progress * (0.15 + 0.8 * abs(sin(Double(index) / 2.1))))
        }
    )
    .padding(.vertical, 24)
}
