import SwiftUI

/// Fixed dark palette matching desktop `base.css`.
struct ThemeDerived: Equatable {
    let accent: String
    let fg: String
    let bg: String
    let fgMuted: String
    let bgSecondary: String
    let bgElevated: String
    let borderDark: String
    let borderLight: String
    let border: String
    let accentReadable: String
    let selectionBg: String
    let selectionFg: String
    let sidebarControlHoverBg: String
    let sidebarControlActiveHoverBg: String

    static let dark = ThemeDerived(
        accent: "#5b9cf5",
        fg: "#ffffff",
        bg: "#000000",
        fgMuted: "#999999",
        bgSecondary: "#111111",
        bgElevated: "#222222",
        borderDark: "#333333",
        borderLight: "#777777",
        border: "#333333",
        accentReadable: "#87b5f4",
        selectionBg: "#416eac",
        selectionFg: "#ffffff",
        sidebarControlHoverBg: "#26282b",
        sidebarControlActiveHoverBg: "#2e4463"
    )
}

struct HarnessTheme: Equatable {
    let derived: ThemeDerived

    static let `default` = HarnessTheme(derived: .dark)

    var fgColor: Color { Color(themeHex: derived.fg) }
    var bgColor: Color { Color(themeHex: derived.bg) }
    var bgSecondaryColor: Color { Color(themeHex: derived.bgSecondary) }
    var bgElevatedColor: Color { Color(themeHex: derived.bgElevated) }
    var fgMutedColor: Color { Color(themeHex: derived.fgMuted) }
    var accentColor: Color { Color(themeHex: derived.accent) }
}

@MainActor
final class ThemeStore: ObservableObject {
    @Published private(set) var harnessTheme: HarnessTheme = .default

    var preferredColorScheme: ColorScheme? { .dark }

    func reload() {}
}

private struct ThemeHexRGB {
    let red: Double
    let green: Double
    let blue: Double

    init(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        if value.count == 3 {
            value = value.map { String(repeating: $0, count: 2) }.joined()
        }
        red = Double(Int(value.prefix(2), radix: 16) ?? 0) / 255
        green = Double(Int(value.dropFirst(2).prefix(2), radix: 16) ?? 0) / 255
        blue = Double(Int(value.suffix(2), radix: 16) ?? 0) / 255
    }
}

extension Color {
    init(themeHex hex: String) {
        let rgb = ThemeHexRGB(hex: hex)
        self.init(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }
}

private struct HarnessThemeKey: EnvironmentKey {
    static let defaultValue = HarnessTheme.default
}

extension EnvironmentValues {
    var harnessTheme: HarnessTheme {
        get { self[HarnessThemeKey.self] }
        set { self[HarnessThemeKey.self] = newValue }
    }
}
