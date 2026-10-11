import SwiftUI
import WidgetKit

/// Static home screen widget: the Harness horse mark. Tapping it opens the app.
struct HorseMarkWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HorseMarkWidget", provider: HorseMarkProvider()) { _ in
            HorseMarkWidgetView()
        }
        .configurationDisplayName("Harness")
        .description("The Harness horse.")
        .supportedFamilies([.systemSmall])
        .contentMarginsDisabled()
    }
}

private struct HorseMarkEntry: TimelineEntry {
    let date: Date
}

private struct HorseMarkProvider: TimelineProvider {
    func placeholder(in context: Context) -> HorseMarkEntry {
        HorseMarkEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (HorseMarkEntry) -> Void) {
        completion(HorseMarkEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HorseMarkEntry>) -> Void) {
        completion(Timeline(entries: [HorseMarkEntry(date: .now)], policy: .never))
    }
}

private struct HorseMarkWidgetView: View {
    var body: some View {
        // Asset is the full 1024 icon canvas, so the mark keeps the app icon's proportions.
        Image("HorseMark")
            .resizable()
            .scaledToFit()
            .foregroundStyle(.white)
            .widgetAccentable()
            .containerBackground(.black, for: .widget)
    }
}
