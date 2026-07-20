import SwiftUI

/// Joy Division "Unknown Pleasures"-style stacked ridgeline driven by live metering.
///
/// Performance: drawing and row history live in a UIKit `JoyDivisionWaveformView` with a
/// CADisplayLink paint loop. This shell only forwards the scalar mic level — no SwiftUI
/// `@State` row arrays, `TimelineView`, `Canvas`, or `drawingGroup`.
struct LiveAudioWaveformView: View {
    var level: CGFloat = 0
    var color: Color = .primary
    var width: CGFloat = 240
    var height: CGFloat = 320

    var body: some View {
        JoyDivisionWaveformRepresentable(level: level, color: color)
            .frame(width: width, height: height)
    }
}

private struct JoyDivisionWaveformRepresentable: UIViewRepresentable {
    var level: CGFloat
    var color: Color

    func makeUIView(context: Context) -> JoyDivisionWaveformView {
        let view = JoyDivisionWaveformView()
        view.level = level
        view.strokeColor = UIColor(color)
        return view
    }

    func updateUIView(_ uiView: JoyDivisionWaveformView, context: Context) {
        uiView.level = level
        uiView.strokeColor = UIColor(color)
    }
}

#Preview("Silent") {
    LiveAudioWaveformView(level: 0)
        .padding(40)
}

#Preview("Quiet speech") {
    LiveAudioWaveformView(level: 0.22)
        .padding(40)
}

#Preview("Loud peaks") {
    LiveAudioWaveformView(level: 0.85)
        .padding(40)
}
