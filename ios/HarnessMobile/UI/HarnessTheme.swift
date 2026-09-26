import SwiftUI

/// Mirrors the desktop palette in `src/renderer/base.css` (fixed dark, single accent).
/// Hues match desktop; shapes stay platform-native.
enum HarnessPalette {
    /// `--bg`: page shell behind every surface.
    static let background = Color(hex: 0x111111)
    /// `--bg-secondary`: cards, user messages, fields.
    static let surface = Color(hex: 0x1C1C1C)
    /// `--btn-bg`: neutral control fill.
    static let control = Color(hex: 0x2E3033)
    /// `--border-input`: hairlines around composer, cards, chips.
    static let hairline = Color(hex: 0x2C2C2C)
    /// Blockquote rule: visible but quieter than text.
    static let rule = Color(hex: 0x3A3A3A)
    /// Code well: desktop `.md-code-block` (#000) softened for OLED smear.
    static let well = Color(hex: 0x0A0A0A)
    /// `--border-edge`: list separators.
    static let separator = Color(hex: 0x222222)

    /// `--fg`
    static let text = Color(hex: 0xCCCCCC)
    /// Headings, strong, code: one step brighter than body so weight reads on dark.
    static let textStrong = Color(hex: 0xE4E4E4)
    /// `--fg-muted`
    static let textMuted = Color(hex: 0x999999)
    /// Timestamps, placeholders, quotes.
    static let textFaint = Color(hex: 0x6A6C6F)

    /// `--accent`
    static let accent = Color(hex: 0x5B9CF5)
    /// `--accent-readable`: accent 72% toward white, for text on dark.
    static let accentReadable = Color(hex: 0x89B8F8)
    /// `--btn-primary-bg`: accent 38% over `--bg`.
    static let primaryFill = Color(hex: 0x2D4668)
    /// `--accent-tint`: accent 12% over `--bg`.
    static let accentTint = Color(hex: 0x1A222C)

    /// Recording state only.
    static let recording = Color(hex: 0xE5534B)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Round icon control in the composer and bottom bar.
struct HarnessIconButtonLabel: View {
    enum Role {
        /// Neutral fill (`--btn-bg`).
        case neutral
        /// Accent-tinted fill with readable accent glyph (`--btn-primary-*`).
        case primary
    }

    let systemName: String
    var role: Role = .neutral
    var size: CGFloat = 36
    var glyphSize: CGFloat = 16

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: glyphSize, weight: .semibold))
            .foregroundStyle(role == .primary ? HarnessPalette.accentReadable : HarnessPalette.text)
            .frame(width: size, height: size)
            .background(
                Circle().fill(role == .primary ? HarnessPalette.primaryFill : HarnessPalette.control)
            )
    }
}

extension View {
    /// Dark page background under lists and forms, replacing system grouped grays.
    func harnessListBackground() -> some View {
        scrollContentBackground(.hidden)
            .background(HarnessPalette.background.ignoresSafeArea())
    }
}
