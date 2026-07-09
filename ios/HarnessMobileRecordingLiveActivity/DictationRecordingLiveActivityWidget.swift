import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

struct DictationRecordingLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DictationRecordingAttributes.self) { context in
            DictationRecordingLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "mic.fill")
                        .foregroundStyle(.red)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.startedAt, style: .timer)
                        .monospacedDigit()
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Button(intent: StopDictationRecordingIntent()) {
                        Image(systemName: "stop.fill")
                    }
                    .tint(.red)
                }
            } compactLeading: {
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
            } compactTrailing: {
                Text(context.attributes.startedAt, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "mic.fill")
                    .foregroundStyle(.red)
            }
        }
    }
}

private struct DictationRecordingLockScreenView: View {
    let context: ActivityViewContext<DictationRecordingAttributes>

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "mic.fill")
                .font(.title3)
                .foregroundStyle(.red)

            VStack(alignment: .leading, spacing: 2) {
                Text("Recording dictation")
                    .font(.headline)
                Text(context.attributes.startedAt, style: .timer)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            Button(intent: StopDictationRecordingIntent()) {
                Label("Stop", systemImage: "stop.circle.fill")
                    .labelStyle(.iconOnly)
                    .font(.title2)
            }
            .tint(.red)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
