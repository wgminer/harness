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

    static func shouldUnlockFromScrollDelta(prevOffset: CGFloat, nextOffset: CGFloat) -> Bool {
        nextOffset < prevOffset - 1
    }

    static func shouldRepinFromUserScroll(
        mode: ChatScrollMode,
        prevOffset: CGFloat,
        nextOffset: CGFloat,
        nearLiveEdge: Bool
    ) -> ChatScrollMode {
        if mode == .free, nearLiveEdge, nextOffset > prevOffset + 1 {
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
    private var lastScrollOffset: CGFloat = 0
    private var contentOffset: CGFloat = 0
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
        mode = .pinned
    }

    func updateContentOffset(_ offset: CGFloat) {
        contentOffset = offset
        applyScrollDelta()
    }

    func updateContentBottom(_ bottom: CGFloat) {
        contentBottom = bottom
        applyScrollDelta()
    }

    func updateViewportBottom(_ bottom: CGFloat) {
        viewportBottom = bottom
        applyScrollDelta()
    }

    private func applyScrollDelta() {
        let nearLiveEdge = ChatScrollLogic.isNearLiveEdge(
            contentBottom: contentBottom,
            viewportBottom: viewportBottom
        )
        if ChatScrollLogic.shouldUnlockFromScrollDelta(prevOffset: lastScrollOffset, nextOffset: contentOffset) {
            userTookOver = true
            mode = .free
        }
        mode = ChatScrollLogic.shouldRepinFromUserScroll(
            mode: mode,
            prevOffset: lastScrollOffset,
            nextOffset: contentOffset,
            nearLiveEdge: nearLiveEdge
        )
        lastScrollOffset = contentOffset
    }

    func onUserDraggedUp() {
        userTookOver = true
        mode = .free
    }

    func reset() {
        userTookOver = false
        mode = .pinned
        prevSending = false
        lastScrollOffset = 0
        contentOffset = 0
        contentBottom = 0
        viewportBottom = 0
    }
}

private struct ScrollContentOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
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

/// Placed at the top of the transcript; reports scroll content offset only.
struct ChatScrollOffsetTracker: View {
    var body: some View {
        GeometryReader { geo in
            Color.clear
                .preference(
                    key: ScrollContentOffsetKey.self,
                    value: geo.frame(in: .named("chatScroll")).minY
                )
        }
        .frame(height: 0)
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
            .onPreferenceChange(ScrollContentOffsetKey.self) { controller.updateContentOffset($0) }
            .onPreferenceChange(ScrollContentBottomKey.self) { bottom in
                controller.updateContentBottom(bottom)
                onContentBottomChange(bottom)
            }
            .onPreferenceChange(ScrollViewportBottomKey.self) { controller.updateViewportBottom($0) }
    }
}
