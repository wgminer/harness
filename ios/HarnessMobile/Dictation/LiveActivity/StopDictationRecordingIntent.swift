import AppIntents
import Foundation

struct StopDictationRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Recording"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        return .result()
    }
}
