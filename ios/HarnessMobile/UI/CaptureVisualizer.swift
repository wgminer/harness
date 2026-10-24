import SwiftUI

/// The circle on the capture home. Idle it is the record button; recording, the ridgeline
/// takes its place on screen.
enum CaptureRing {
    static let radius: CGFloat = 78
    static let lineWidth: CGFloat = 3.5

    /// Offset from the safe-area center to the physical screen center.
    static func centerShift(_ insets: EdgeInsets) -> CGFloat {
        (insets.bottom - insets.top) / 2
    }
}

/// The recording visual: a ridgeline stack that rises with the voice.
struct CaptureVisualizer: View {
    let recorder: AudioRecorder

    var body: some View {
        RidgelineWaveform(
            recorder: recorder,
            stroke: HarnessPalette.textStrong,
            occlusion: HarnessPalette.background
        )
        // Sized so the visible rows (35 row gaps by the inset plot width) are golden: 377 / 233. It
        // overflows the shared visual frame on purpose.
        .frame(width: 265, height: 600)
        // The ridgeline reserves headroom above its first row for tall peaks, which leaves
        // the stack sitting low; lift it so the rows themselves are centered.
        .offset(y: -20)
    }
}
