import Foundation

/// Navigation path for chat compose/thread destinations.
/// Kept separate from `AppModel` so route changes do not invalidate the conversation list.
@MainActor
final class ChatRouter: ObservableObject {
    @Published var route: ChatRoute?

    func openCompose() {
        route = .compose
    }

    func openThread(id: String) {
        route = .thread(id: id)
    }

    func clear() {
        route = nil
    }

    func clearIfThread(id: String) {
        if case .thread(let activeId) = route, activeId == id {
            route = nil
        }
    }
}
