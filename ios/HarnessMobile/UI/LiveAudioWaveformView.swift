import SwiftUI

/// Joy Division "Unknown Pleasures"-style stacked ridgeline driven by live metering.
///
/// Performance: drawing and row history live in a UIKit `JoyDivisionWaveformView` with a
/// CADisplayLink paint loop. The shell wires a meter source; the UIKit view samples
/// `currentMeterLevel` on each display tick — no SwiftUI `@Published` fanout on meter updates.
struct LiveAudioWaveformView: View {
    var meterSource: AudioRecorder?
    var level: CGFloat = 0
    var color: Color = .primary
    var width: CGFloat = 240
    var height: CGFloat = 320

    var body: some View {
        JoyDivisionWaveformRepresentable(meterSource: meterSource, level: level, color: color)
            .frame(width: width, height: height)
    }
}

private struct JoyDivisionWaveformRepresentable: UIViewRepresentable {
    var meterSource: AudioRecorder?
    var level: CGFloat
    var color: Color

    func makeUIView(context: Context) -> JoyDivisionWaveformView {
        let view = JoyDivisionWaveformView()
        view.meterSource = meterSource
        view.level = level
        view.strokeColor = UIColor(color)
        return view
    }

    func updateUIView(_ uiView: JoyDivisionWaveformView, context: Context) {
        uiView.meterSource = meterSource
        if meterSource == nil {
            uiView.level = level
        }
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
