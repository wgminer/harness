import SwiftUI
import UIKit

/// Time-of-day colors, from the same hour table as the desktop theme
/// (`resources/contracts/timeOfDayColors.json`), brightened enough to read as an accent on dark.
struct DaylightPalette {
    /// Interpolated sky color for the hour, as on desktop.
    let sky: Color
    /// The sky hue, saturated and brightened so it reads on the dark shell.
    let accent: Color

    private static let hourColors: [UIColor] = loadHourColors()
    private static var cached: (minute: Int, palette: DaylightPalette)?

    /// Palette for the current local time; recomputed at most once a minute.
    static var current: DaylightPalette {
        let minute = Int(Date().timeIntervalSinceReferenceDate / 60)
        if let cached, cached.minute == minute { return cached.palette }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: Date())
        let palette = at(hour: Double(parts.hour ?? 0) + Double(parts.minute ?? 0) / 60)
        cached = (minute, palette)
        return palette
    }

    /// `hour` is fractional local time, 0..<24; colors interpolate across the hour.
    static func at(hour: Double) -> DaylightPalette {
        let wrapped = (hour.truncatingRemainder(dividingBy: 24) + 24).truncatingRemainder(dividingBy: 24)
        let index = Int(wrapped) % 24
        let sky = mix(hourColors[index], hourColors[(index + 1) % 24], CGFloat(wrapped - Double(Int(wrapped))))

        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        sky.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return DaylightPalette(
            sky: Color(sky),
            accent: Color(
                UIColor(hue: hue, saturation: min(max(saturation, 0.45), 0.7), brightness: max(brightness, 0.9), alpha: 1)
            )
        )
    }

    static func mix(_ a: UIColor, _ b: UIColor, _ t: CGFloat) -> UIColor {
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        return UIColor(red: ar + (br - ar) * t, green: ag + (bg - ag) * t, blue: ab + (bb - ab) * t, alpha: 1)
    }

    private static func loadHourColors() -> [UIColor] {
        struct Contract: Decodable { let hourColors: [String] }
        guard let url = Bundle.main.url(forResource: "timeOfDayColors", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let contract = try? JSONDecoder().decode(Contract.self, from: data),
              contract.hourColors.count == 24
        else {
            return Array(repeating: UIColor(HarnessPalette.staticAccent), count: 24)
        }
        return contract.hourColors.map { hex in
            UIColor(Color(hex: UInt32(hex.dropFirst(), radix: 16) ?? 0x5B9CF5))
        }
    }
}
