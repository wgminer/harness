import ActivityKit
import Foundation

struct DictationRecordingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let startedAt: Date
}

extension Notification.Name {
    static let dictationLiveActivityStopRequested = Notification.Name("dictationLiveActivityStopRequested")
}
