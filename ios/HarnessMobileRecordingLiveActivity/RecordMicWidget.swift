import SwiftUI
import WidgetKit

/// Lock screen widget: a microphone that opens Harness straight into recording.
struct RecordMicWidget: Widget {
    /// Handled by `HarnessMobileApp.onOpenURL`.
    static let recordURL = URL(string: "harness://record")!

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RecordMicWidget", provider: RecordMicProvider()) { _ in
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .widgetAccentable()
            }
            .widgetURL(Self.recordURL)
            .containerBackground(.clear, for: .widget)
            .accessibilityLabel("Record in Harness")
        }
        .configurationDisplayName("Record")
        .description("Open Harness and start recording.")
        .supportedFamilies([.accessoryCircular])
    }
}

private struct RecordMicEntry: TimelineEntry {
    let date: Date
}

private struct RecordMicProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecordMicEntry {
        RecordMicEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (RecordMicEntry) -> Void) {
        completion(RecordMicEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecordMicEntry>) -> Void) {
        completion(Timeline(entries: [RecordMicEntry(date: .now)], policy: .never))
    }
}
