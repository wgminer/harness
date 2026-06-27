import XCTest
@testable import HarnessMobile

final class ThemeResolverTests: XCTestCase {
    func testDarkThemeKeepsSecondarySurfaceCloseToBackground() {
        let derived = ThemeResolver.resolve(
            accent: "#f2ff00",
            fg: "#f5f5f5",
            bg: "#050505"
        )
        XCTAssertEqual(derived.bg, "#050505")
        XCTAssertNotEqual(derived.bgSecondary.lowercased(), derived.bg.lowercased())
        XCTAssertTrue(ThemeResolver.isLightBackground(derived.bg) == false)
    }

    func testLightThemeUsesLightBackground() {
        let derived = ThemeResolver.resolve(
            accent: "#0052ff",
            fg: "#0a0a0a",
            bg: "#fafafa"
        )
        XCTAssertTrue(ThemeResolver.isLightBackground(derived.bg))
    }

    func testNormalizeSettingsReadsDesktopThemeJsonShape() {
        let settings = ThemeResolver.normalizeSettings([
            "accent": "#0091ff",
            "fg": "#b8dcff",
            "bg": "#010810",
            "font": "inter",
            "fontMono": "jetbrains",
            "fontSize": 16,
            "updatedAt": 1_700_000_000_000,
        ])
        XCTAssertEqual(settings.font, "inter")
        XCTAssertEqual(settings.fontMono, "jetbrains")
        XCTAssertEqual(settings.fontSize, 16)
        XCTAssertEqual(settings.updatedAt, 1_700_000_000_000)
    }
}
