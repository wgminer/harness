import ActivityKit
import Foundation

@MainActor
final class RecordingSessionManager: ObservableObject {
    @Published private(set) var liveActivityStopRequested = false

    let recorder = AudioRecorder()

    /// Bumped when a session starts or is cancelled so orphaned LA / start work cannot affect a newer session.
    private var sessionID = 0
    private var liveActivity: Activity<DictationRecordingAttributes>?
    /// Serializes ActivityKit request/end so orphan Tasks do not race.
    private var liveActivityTask: Task<Void, Never>?

    init() {
        // Intentionally do not forward recorder.objectWillChange — metering
        // publishes ~12×/sec and would rebuild every view that observes this
        // session. Dictation UI observes AudioRecorder in leaf views instead.
        NotificationCenter.default.addObserver(
            forName: .dictationLiveActivityStopRequested,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.liveActivityStopRequested = true
        }
    }

    /// Warm mic permission status + audio category (no capture). Safe from home/compose appear.
    func prepareForDictation() {
        recorder.prepare()
    }

    /// Whether the mic prompt can be skipped on the start critical path.
    var hasRecordPermission: Bool {
        recorder.hasRecordPermission
    }

    func acknowledgeLiveActivityStopRequest() {
        liveActivityStopRequested = false
    }

    /// Starts capture and returns as soon as the mic is live. Live Activity is deferred.
    func beginRecordingSession() async throws -> URL {
        liveActivityStopRequested = false
        sessionID += 1
        let id = sessionID

        do {
            let url = try await recorder.start()
            guard id == sessionID else {
                recorder.cancel()
                throw CancellationError()
            }

            let startedAt = Date()
            enqueueLiveActivityWork { [weak self] in
                guard let self, id == self.sessionID else { return }
                await self.startLiveActivity(startedAt: startedAt)
                if id != self.sessionID {
                    await self.endLiveActivity()
                }
            }

            return url
        } catch {
            if id == sessionID {
                recorder.cancel()
                enqueueLiveActivityWork { [weak self] in
                    await self?.endLiveActivity()
                }
            }
            throw error
        }
    }

    /// Tear down capture and Live Activity whether or not recording has fully started.
    func cancelRecordingSession() async {
        sessionID += 1
        liveActivityStopRequested = false
        recorder.cancel()
        enqueueLiveActivityWork { [weak self] in
            await self?.endLiveActivity()
        }
    }

    func endRecordingSession() async {
        // Don't await ActivityKit teardown on the stop/transcribe critical path.
        enqueueLiveActivityWork { [weak self] in
            await self?.endLiveActivity()
        }
    }

    // MARK: - Live Activity (always off the mic critical path)

    private func enqueueLiveActivityWork(_ work: @escaping @MainActor () async -> Void) {
        let previous = liveActivityTask
        liveActivityTask = Task { @MainActor in
            _ = await previous?.value
            await work()
        }
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
