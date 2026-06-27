import SwiftUI

/// Matches desktop `themes/theme.json` and `src/shared/theme.ts`.
struct ThemeSettings: Equatable, Codable {
    var accent: String
    var fg: String
    var bg: String
    var font: String
    var fontMono: String
    var fontSize: Int
    var updatedAt: Int64?

    static let defaultSettings = ThemeSettings(
        accent: "#f2ff00",
        fg: "#f5f5f5",
        bg: "#050505",
        font: "system",
        fontMono: "sf",
        fontSize: 14,
        updatedAt: nil
    )
}

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
}

struct HarnessTheme: Equatable {
    let settings: ThemeSettings
    let derived: ThemeDerived

    static let `default` = HarnessTheme(settings: .defaultSettings)

    init(settings: ThemeSettings) {
        self.settings = settings
        self.derived = ThemeResolver.resolve(settings)
    }

    var fgColor: Color { Color(themeHex: derived.fg) }
    var bgColor: Color { Color(themeHex: derived.bg) }
    var bgSecondaryColor: Color { Color(themeHex: derived.bgSecondary) }
    var bgElevatedColor: Color { Color(themeHex: derived.bgElevated) }
    var fgMutedColor: Color { Color(themeHex: derived.fgMuted) }
    var accentColor: Color { Color(themeHex: derived.accent) }
}

enum ThemeResolver {
    static let syncRelPath = "themes/theme.json"

    static func resolve(_ settings: ThemeSettings) -> ThemeDerived {
        resolve(accent: settings.accent, fg: settings.fg, bg: settings.bg)
    }

    static func resolve(accent: String, fg: String, bg: String) -> ThemeDerived {
        let accentHex = normalizeHex(accent)
        let fgHex = normalizeHex(fg)
        let bgHex = normalizeHex(bg)

        if isLightBackground(bgHex) {
            let neutral = "#b8bcc4"
            return ThemeDerived(
                accent: accentHex,
                fg: fgHex,
                bg: bgHex,
                fgMuted: mixOklab(base: fgHex, toward: bgHex, baseWeight: 0.62),
                bgSecondary: bgHex,
                bgElevated: mixOklab(base: bgHex, toward: neutral, baseWeight: 0.96),
                borderDark: mixOklab(base: bgHex, toward: neutral, baseWeight: 0.82),
                borderLight: mixOklab(base: bgHex, toward: neutral, baseWeight: 0.88),
                border: mixOklab(base: bgHex, toward: neutral, baseWeight: 0.82),
                accentReadable: mixOklab(base: accentHex, toward: fgHex, baseWeight: 0.88),
                selectionBg: mixOklab(base: accentHex, toward: bgHex, baseWeight: 0.82),
                selectionFg: mixOklab(base: bgHex, toward: fgHex, baseWeight: 0.7),
                sidebarControlHoverBg: mixSrgb(base: fgHex, toward: bgHex, baseWeight: 0.06),
                sidebarControlActiveHoverBg: mixSrgb(base: accentHex, toward: bgHex, baseWeight: 0.88)
            )
        }

        let mix = surfaceMix(for: bgHex)
        let surfaceTone = surfaceToneHex(fg: fgHex, accent: accentHex, bg: bgHex)
        let fgMutedTone = mixOklab(base: fgHex, toward: accentHex, baseWeight: 0.68)
        let bgSecondary = mixOklab(base: bgHex, toward: surfaceTone, baseWeight: mix.bgSecondaryBgPct / 100)
        return ThemeDerived(
            accent: accentHex,
            fg: fgHex,
            bg: bgHex,
            fgMuted: mixOklab(base: fgMutedTone, toward: bgHex, baseWeight: mix.fgMutedFgPct / 100),
            bgSecondary: bgSecondary,
            bgElevated: mixOklab(base: bgHex, toward: surfaceTone, baseWeight: mix.bgElevatedBgPct / 100),
            borderDark: mixOklab(base: bgHex, toward: surfaceTone, baseWeight: mix.borderDarkBgPct / 100),
            borderLight: mixOklab(base: bgHex, toward: surfaceTone, baseWeight: mix.borderLightBgPct / 100),
            border: mixOklab(base: bgHex, toward: surfaceTone, baseWeight: mix.borderDarkBgPct / 100),
            accentReadable: mixOklab(base: accentHex, toward: fgHex, baseWeight: mix.accentReadableAccentPct / 100),
            selectionBg: mixOklab(base: accentHex, toward: bgHex, baseWeight: mix.selectionAccentPct / 100),
            selectionFg: mixOklab(base: bgHex, toward: fgHex, baseWeight: 0.7),
            sidebarControlHoverBg: mixSrgb(base: fgHex, toward: bgSecondary, baseWeight: mix.sidebarHoverFgPct / 100),
            sidebarControlActiveHoverBg: mixSrgb(base: accentHex, toward: bgSecondary, baseWeight: mix.sidebarActiveAccentPct / 100)
        )
    }

    static func normalizeSettings(_ raw: [String: Any]) -> ThemeSettings {
        var settings = ThemeSettings.defaultSettings
        if let accent = parseHex(raw["accent"] as? String) { settings.accent = accent }
        if let fg = parseHex(raw["fg"] as? String) { settings.fg = fg }
        if let bg = parseHex(raw["bg"] as? String) { settings.bg = bg }
        if let font = raw["font"] as? String { settings.font = font }
        if let fontMono = raw["fontMono"] as? String { settings.fontMono = fontMono }
        if let fontSize = raw["fontSize"] as? Int { settings.fontSize = fontSize }
        if let fontSize = raw["fontSize"] as? Double { settings.fontSize = Int(fontSize) }
        if let updatedAt = raw["updatedAt"] as? Int64 { settings.updatedAt = updatedAt }
        if let updatedAt = raw["updatedAt"] as? Int { settings.updatedAt = Int64(updatedAt) }
        if let updatedAt = raw["updatedAt"] as? Double { settings.updatedAt = Int64(updatedAt) }
        return settings
    }

    static func isLightBackground(_ bg: String) -> Bool {
        relativeLuminance(hexToRgb(normalizeHex(bg))) > 0.55
    }

    private struct SurfaceMix {
        let fgMutedFgPct: Double
        let bgSecondaryBgPct: Double
        let bgElevatedBgPct: Double
        let borderLightBgPct: Double
        let borderDarkBgPct: Double
        let accentReadableAccentPct: Double
        let selectionAccentPct: Double
        let sidebarActiveAccentPct: Double
        let sidebarHoverFgPct: Double
    }

    private static func surfaceMix(for bg: String) -> SurfaceMix {
        return SurfaceMix(
            fgMutedFgPct: 70,
            bgSecondaryBgPct: 88,
            bgElevatedBgPct: 78,
            borderLightBgPct: 68,
            borderDarkBgPct: 58,
            accentReadableAccentPct: 86,
            selectionAccentPct: 80,
            sidebarActiveAccentPct: 88,
            sidebarHoverFgPct: 14
        )
    }

    private static func surfaceToneHex(fg: String, accent: String, bg: String) -> String {
        if isLightBackground(bg) { return fg }
        return mixOklab(base: fg, toward: accent, baseWeight: 0.74)
    }

    private static func mixOklab(base: String, toward: String, baseWeight: Double) -> String {
        let okA = rgbToOklab(hexToRgb(base))
        let okB = rgbToOklab(hexToRgb(toward))
        let w = clamp(baseWeight, 0, 1)
        return rgbToHex(oklabToRgb(
            okA[0] * w + okB[0] * (1 - w),
            okA[1] * w + okB[1] * (1 - w),
            okA[2] * w + okB[2] * (1 - w)
        ))
    }

    private static func mixSrgb(base: String, toward: String, baseWeight: Double) -> String {
        let a = hexToRgb(base)
        let b = hexToRgb(toward)
        let w = clamp(baseWeight, 0, 1)
        return rgbToHex((
            Int(round(Double(a.0) * w + Double(b.0) * (1 - w))),
            Int(round(Double(a.1) * w + Double(b.1) * (1 - w))),
            Int(round(Double(a.2) * w + Double(b.2) * (1 - w)))
        ))
    }

    private static func normalizeHex(_ raw: String) -> String {
        parseHex(raw) ?? "#000000"
    }

    private static func parseHex(_ raw: String?) -> String? {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), value.hasPrefix("#") else {
            return nil
        }
        value.removeFirst()
        if value.count == 3 {
            value = value.map { String(repeating: $0, count: 2) }.joined()
        }
        guard value.count == 6, value.allSatisfy({ $0.isHexDigit }) else { return nil }
        return "#" + value.lowercased()
    }

    private static func hexToRgb(_ hex: String) -> (Int, Int, Int) {
        let normalized = normalizeHex(hex)
        let v = String(normalized.dropFirst())
        return (
            Int(v.prefix(2), radix: 16) ?? 0,
            Int(v.dropFirst(2).prefix(2), radix: 16) ?? 0,
            Int(v.suffix(2), radix: 16) ?? 0
        )
    }

    private static func rgbToHex(_ rgb: (Int, Int, Int)) -> String {
        String(format: "#%02x%02x%02x", clamp(rgb.0, 0, 255), clamp(rgb.1, 0, 255), clamp(rgb.2, 0, 255))
    }

    private static func srgbChannelToLinear(_ c: Int) -> Double {
        let v = Double(c) / 255
        return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }

    private static func linearToSrgb(_ c: Double) -> Double {
        c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055
    }

    private static func relativeLuminance(_ rgb: (Int, Int, Int)) -> Double {
        let r = srgbChannelToLinear(rgb.0)
        let g = srgbChannelToLinear(rgb.1)
        let b = srgbChannelToLinear(rgb.2)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    private static func rgbToOklab(_ rgb: (Int, Int, Int)) -> [Double] {
        let r = srgbChannelToLinear(rgb.0)
        let g = srgbChannelToLinear(rgb.1)
        let b = srgbChannelToLinear(rgb.2)
        let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
        let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
        let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
        let lC = pow(l, 1.0 / 3.0)
        let mC = pow(m, 1.0 / 3.0)
        let sC = pow(s, 1.0 / 3.0)
        return [
            0.2104542553 * lC + 0.793617785 * mC - 0.0040720468 * sC,
            1.9779984951 * lC - 2.428592205 * mC + 0.4505937099 * sC,
            0.0259040371 * lC + 0.7827717662 * mC - 0.808675766 * sC,
        ]
    }

    private static func oklabToRgb(_ L: Double, _ a: Double, _ b: Double) -> (Int, Int, Int) {
        let lC = L + 0.3963377774 * a + 0.2158037573 * b
        let mC = L - 0.1055613458 * a - 0.0638541728 * b
        let sC = L - 0.0894841775 * a - 1.291485548 * b
        let l = lC * lC * lC
        let m = mC * mC * mC
        let s = sC * sC * sC
        let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
        let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
        return (
            Int(round(clamp(linearToSrgb(r), 0, 1) * 255)),
            Int(round(clamp(linearToSrgb(g), 0, 1) * 255)),
            Int(round(clamp(linearToSrgb(bl), 0, 1) * 255))
        )
    }

    private static func clamp(_ value: Double, _ min: Double, _ max: Double) -> Double {
        Swift.min(max, Swift.max(min, value))
    }

    private static func clamp(_ value: Int, _ min: Int, _ max: Int) -> Int {
        Swift.min(max, Swift.max(min, value))
    }
}

@MainActor
final class ThemeStore: ObservableObject {
    @Published private(set) var harnessTheme: HarnessTheme

    private let localDataDir: URL

    init(localDataDir: URL) {
        self.localDataDir = localDataDir
        self.harnessTheme = ThemeStore.loadTheme(from: localDataDir) ?? .default
    }

    var preferredColorScheme: ColorScheme? {
        ThemeResolver.isLightBackground(harnessTheme.derived.bg) ? .light : .dark
    }

    func reload() {
        harnessTheme = ThemeStore.loadTheme(from: localDataDir) ?? .default
    }

    private static func loadTheme(from localDataDir: URL) -> HarnessTheme? {
        let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: ThemeResolver.syncRelPath)
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return HarnessTheme(settings: ThemeResolver.normalizeSettings(object))
    }
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
