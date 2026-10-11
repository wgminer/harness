import Foundation

/// Navigation path for chat thread destinations.
/// Kept separate from `AppModel` so route changes do not invalidate the conversation list.
@MainActor
final class ChatRouter: ObservableObject {
    @Published var route: ChatRoute?
    /// The list (captures, chats, tasks, settings) sits behind the capture home, in a sheet.
    @Published var listOpen = false

    func openThread(id: String) {
        route = .thread(id: id)
        listOpen = true
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
