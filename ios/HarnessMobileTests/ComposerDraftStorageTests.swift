import XCTest
@testable import HarnessMobile

final class ComposerDraftStorageTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "HarnessMobileTests.ComposerDraftStorage"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
        ComposerDraftStorage.userDefaults = defaults
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        ComposerDraftStorage.userDefaults = .standard
        super.tearDown()
    }

    func testComposeDraftRoundTrip() {
        ComposerDraftStorage.saveComposeDraft("hello")
        XCTAssertEqual(ComposerDraftStorage.loadComposeDraft(), "hello")

        ComposerDraftStorage.saveComposeDraft("   ")
        XCTAssertEqual(ComposerDraftStorage.loadComposeDraft(), "")
    }

    func testThreadDraftsRoundTrip() {
        ComposerDraftStorage.saveThreadDrafts(["a": "draft a", "b": "draft b"])
        let loaded = ComposerDraftStorage.loadThreadDrafts()
        XCTAssertEqual(loaded["a"], "draft a")
        XCTAssertEqual(loaded["b"], "draft b")

        ComposerDraftStorage.saveThreadDrafts([:])
        XCTAssertTrue(ComposerDraftStorage.loadThreadDrafts().isEmpty)
    }
}
