import SwiftUI

struct LiveAudioWaveformView: View {
    let samples: [CGFloat]
    var barColor: Color = .red
    var maxBarHeight: CGFloat = 72
    var minBarHeight: CGFloat = 6
    var horizontalInset: CGFloat = 0
    var barSpacing: CGFloat = 2

    var body: some View {
        GeometryReader { geometry in
            let availableWidth = max(geometry.size.width - (horizontalInset * 2), 1)
            let count = max(samples.count, 1)
            let totalSpacing = barSpacing * CGFloat(max(count - 1, 0))
            let barWidth = max(2, (availableWidth - totalSpacing) / CGFloat(count))

            HStack(alignment: .center, spacing: barSpacing) {
                ForEach(Array(samples.enumerated()), id: \.offset) { _, level in
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(barColor.opacity(0.9))
                        .frame(width: barWidth, height: barHeight(for: level))
                }
            }
            .frame(width: availableWidth, height: maxBarHeight)
            .frame(maxWidth: .infinity)
        }
        .frame(height: maxBarHeight)
        .animation(.easeOut(duration: 0.05), value: samples)
        .accessibilityLabel("Live audio level")
        .accessibilityValue(accessibilityLevelDescription)
    }

    private func barHeight(for level: CGFloat) -> CGFloat {
        let clamped = min(max(level, 0), 1)
        return minBarHeight + clamped * (maxBarHeight - minBarHeight)
    }

    private var accessibilityLevelDescription: String {
        guard let latest = samples.last else { return "Silent" }
        if latest < 0.08 { return "Silent" }
        if latest < 0.35 { return "Quiet" }
        if latest < 0.7 { return "Moderate" }
        return "Loud"
    }
}

#Preview("Waveform") {
    LiveAudioWaveformView(
        samples: (0 ..< 40).map { index in
            CGFloat(0.15 + 0.65 * abs(sin(Double(index) / 4.0)))
        }
    )
}
