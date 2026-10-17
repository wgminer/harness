import SwiftUI

/// The app's front door: a bare circle that starts a recording and becomes the recording visual.
/// Everything else (captures, chats, tasks, settings) lives in the list, one swipe up.
struct CaptureHomeView: View {
    /// Not observed: sync and setup churn on `AppModel` must not rebuild the capture surface.
    let app: AppModel
    /// True while a home capture is in flight (recording, transcribing, or failed).
    let isCapturing: Bool
    var onOpenList: () -> Void

    @State private var showSaved = false
    @State private var savedGeneration = 0

    var body: some View {
        GeometryReader { proxy in
            content(centerShift: CaptureRing.centerShift(proxy.safeAreaInsets))
        }
    }

    private func content(centerShift: CGFloat) -> some View {
        ZStack {
            HarnessPalette.background.ignoresSafeArea()

            if isCapturing {
                DictationRecordingSheet(
                    app: app,
                    mode: .createSession,
                    style: .immersive,
                    isPresented: capturingBinding,
                    onConversationCreated: { _ in
                        app.dismissDictation()
                        flashSaved()
                    }
                )
                .transition(.opacity)
            } else {
                idle(centerShift: centerShift)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeOut(duration: 0.18), value: isCapturing)
    }

    private var capturingBinding: Binding<Bool> {
        Binding(
            get: { isCapturing },
            set: { if !$0 { app.dismissDictation() } }
        )
    }

    private func idle(centerShift: CGFloat) -> some View {
        // Only the circle records; the rest of the screen is inert so a stray tap cannot start a take.
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 24).onEnded { value in
                    if value.translation.height < -60 { openList() }
                }
            )
            .overlay {
                if showSaved {
                    Text("Saved")
                        .font(.title2.weight(.medium))
                        .foregroundStyle(HarnessPalette.textStrong)
                        .transition(.opacity.combined(with: .scale(scale: 0.92)))
                        .allowsHitTesting(false)
                } else {
                    Button(action: startCapture) {
                        Circle()
                            .stroke(HarnessPalette.textStrong, lineWidth: CaptureRing.lineWidth)
                            .frame(width: CaptureRing.radius * 2, height: CaptureRing.radius * 2)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .offset(y: centerShift)
                    .transition(.opacity)
                    .accessibilityLabel("Record")
                }
            }
            .overlay(alignment: .bottom) {
                Button(action: openList) {
                    // Points the way the swipe goes: the list sits above the capture screen.
                    Image(systemName: "chevron.up")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(HarnessPalette.textMuted)
                        .frame(width: 72, height: 56)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show list")
                .padding(.bottom, 12)
            }
    }

    private func openList() {
        HapticFeedback.light()
        onOpenList()
    }

    private func startCapture() {
        HapticFeedback.medium()
        showSaved = false
        app.beginCreateSessionDictation()
    }

    private func flashSaved() {
        savedGeneration += 1
        let generation = savedGeneration
        withAnimation(.easeOut(duration: 0.2)) { showSaved = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            guard generation == savedGeneration else { return }
            withAnimation(.easeIn(duration: 0.4)) { showSaved = false }
        }
    }
}

/// Stop control while recording: a ring around a stop square, in thumb reach.
struct CaptureShutter: View {
    static let bottomInset: CGFloat = 46
    static let diameter: CGFloat = 84

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(HarnessPalette.textStrong, lineWidth: 4)
                .frame(width: Self.diameter, height: Self.diameter)
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(HarnessPalette.recording)
                .frame(width: 32, height: 32)
        }
        .contentShape(Circle())
    }
}

#Preview("Ready") {
    CaptureHomeView(
        app: PreviewSupport.emptyApp(syncNotConfigured: false, needsAPIKey: false),
        isCapturing: false,
        onOpenList: {}
    )
}
