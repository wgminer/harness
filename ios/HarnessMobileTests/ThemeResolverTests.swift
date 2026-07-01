import XCTest
@testable import HarnessMobile

final class ThemeResolverTests: XCTestCase {
    func testDefaultPaletteMatchesDesktopDarkTokens() {
        let theme = HarnessTheme.default
        XCTAssertEqual(theme.derived.bg, "#000000")
        XCTAssertEqual(theme.derived.fg, "#ffffff")
        XCTAssertEqual(theme.derived.accent, "#5b9cf5")
        XCTAssertEqual(theme.derived.bgSecondary, "#111111")
    }
}
