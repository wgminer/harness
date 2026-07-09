import ActivityKit
import Combine
import Foundation

@MainActor
final class RecordingSessionManager: ObservableObject {
    @Published private(set) var liveActivityStopRequested = false

    let recorder = AudioRecorder()

    private var cancellables = Set<AnyCancellable>()
    private var liveActivity: Activity<DictationRecordingAttributes>?

    init() {
        recorder.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)

        NotificationCenter.default.addObserver(
            forName: .dictationLiveActivityStopRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.liveActivityStopRequested = true
        }
    }

    func acknowledgeLiveActivityStopRequest() {
        liveActivityStopRequested = false
    }

    func beginRecordingSession() async throws -> URL {
        liveActivityStopRequested = false
        let url = try await recorder.start()
        await startLiveActivity(startedAt: Date())
        return url
    }

    func endRecordingSession() async {
        await endLiveActivity()
    }

    private func startLiveActivity(startedAt: Date) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        await endLiveActivity()

        let attributes = DictationRecordingAttributes(startedAt: startedAt)
        let content = ActivityContent(state: DictationRecordingAttributes.ContentState(), staleDate: nil)

        do {
            liveActivity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
        } catch {
            liveActivity = nil
        }
    }

    private func endLiveActivity() async {
        let activities = Activity<DictationRecordingAttributes>.activities
        for activity in activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        liveActivity = nil
    }
}
