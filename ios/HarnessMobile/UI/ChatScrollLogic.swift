import CoreGraphics
import SwiftUI

enum ChatScrollMode: Equatable {
    case pinned
    case free
}

enum ChatScrollLogic {
    static let liveEdgeTolerance: CGFloat = 48

    static func distanceFromLiveEdge(contentBottom: CGFloat, viewportBottom: CGFloat) -> CGFloat {
        contentBottom - viewportBottom
    }

    static func isNearLiveEdge(
        contentBottom: CGFloat,
        viewportBottom: CGFloat,
        tolerance: CGFloat = liveEdgeTolerance
    ) -> Bool {
        distanceFromLiveEdge(contentBottom: contentBottom, viewportBottom: viewportBottom) <= tolerance
    }

    static func didTurnJustStart(prevSending: Bool, sending: Bool) -> Bool {
        !prevSending && sending
    }

    static func shouldFollowTranscriptResize(mode: ChatScrollMode, userTookOver: Bool) -> Bool {
        mode == .pinned && !userTookOver
    }

    /// Repin when free-mode content sits near the live edge (user scrolled back down).
    static func shouldRepinNearLiveEdge(mode: ChatScrollMode, nearLiveEdge: Bool) -> ChatScrollMode {
        if mode == .free, nearLiveEdge {
            return .pinned
        }
        return mode
    }
}

@MainActor
final class ChatScrollController: ObservableObject {
    @Published private(set) var mode: ChatScrollMode = .pinned

    private var userTookOver = false
    private var prevSending = false
    private var contentBottom: CGFloat = 0
    private var viewportBottom: CGFloat = 0

    var shouldFollow: Bool {
        ChatScrollLogic.shouldFollowTranscriptResize(mode: mode, userTookOver: userTookOver)
    }

    func onSendingChange(_ sending: Bool) {
        let justStarted = ChatScrollLogic.didTurnJustStart(prevSending: prevSending, sending: sending)
        prevSending = sending
        if justStarted {
            pinForTurn()
        }
    }

    func pinForTurn() {
        userTookOver = false
        setMode(.pinned)
    }

    func updateContentBottom(_ bottom: CGFloat) {
        guard abs(bottom - contentBottom) > 0.5 else { return }
        contentBottom = bottom
        applyLiveEdge()
    }

    func updateViewportBottom(_ bottom: CGFloat) {
        guard abs(bottom - viewportBottom) > 0.5 else { return }
        viewportBottom = bottom
        applyLiveEdge()
    }

    private func applyLiveEdge() {
        let nearLiveEdge = ChatScrollLogic.isNearLiveEdge(
            contentBottom: contentBottom,
            viewportBottom: viewportBottom
        )
        // Unlock only via onUserDraggedUp (finger drag toward older messages).
        setMode(ChatScrollLogic.shouldRepinNearLiveEdge(mode: mode, nearLiveEdge: nearLiveEdge))
    }

    func onUserDraggedUp() {
        userTookOver = true
        setMode(.free)
    }

    func reset() {
        userTookOver = false
        setMode(.pinned)
        prevSending = false
        contentBottom = 0
        viewportBottom = 0
    }

    private func setMode(_ newMode: ChatScrollMode) {
        guard mode != newMode else { return }
        mode = newMode
    }
}

private struct ScrollContentBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ScrollViewportBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// Placed at the bottom of the transcript; reports content bottom only.
struct ChatScrollBottomTracker: View {
    var body: some View {
        GeometryReader { geo in
            Color.clear
                .preference(
                    key: ScrollContentBottomKey.self,
                    value: geo.frame(in: .named("chatScroll")).maxY
                )
        }
        .frame(height: 0)
    }
}

struct ChatScrollViewportTracker: View {
    var body: some View {
        GeometryReader { geo in
            Color.clear
                .preference(
                    key: ScrollViewportBottomKey.self,
                    value: geo.frame(in: .named("chatScroll")).maxY
                )
        }
    }
}

struct ChatScrollPreferenceHandlers: ViewModifier {
    @ObservedObject var controller: ChatScrollController
    var onContentBottomChange: (CGFloat) -> Void

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(ScrollContentBottomKey.self) { bottom in
                controller.updateContentBottom(bottom)
                onContentBottomChange(bottom)
            }
            .onPreferenceChange(ScrollViewportBottomKey.self) { controller.updateViewportBottom($0) }
    }
}
