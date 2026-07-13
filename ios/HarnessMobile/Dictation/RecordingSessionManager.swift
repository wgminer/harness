import ActivityKit
import Combine
import Foundation

@MainActor
final class RecordingSessionManager: ObservableObject {
    @Published private(set) var liveActivityStopRequested = false

    let recorder = AudioRecorder()

    private var cancellables = Set<AnyCancellable>()
    private var liveActivity: Activity<DictationRecordingAttributes>?
    /// Bumped when a session starts or is cancelled so orphaned start work cannot tear down a newer session.
    private var sessionEpoch = 0

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
        sessionEpoch += 1
        let epoch = sessionEpoch

        do {
            let url = try await recorder.start()
            guard epoch == sessionEpoch else {
                recorder.cancel()
                throw CancellationError()
            }

            await startLiveActivity(startedAt: Date())
            guard epoch == sessionEpoch else {
                recorder.cancel()
                await endLiveActivity()
                throw CancellationError()
            }

            return url
        } catch {
            if epoch == sessionEpoch {
                recorder.cancel()
                await endLiveActivity()
            }
            throw error
        }
    }

    /// Tear down capture and Live Activity whether or not recording has fully started.
    func cancelRecordingSession() async {
        sessionEpoch += 1
        liveActivityStopRequested = false
        recorder.cancel()
        await endLiveActivity()
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
