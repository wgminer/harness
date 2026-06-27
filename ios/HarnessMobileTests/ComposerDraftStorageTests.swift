import XCTest
@testable import HarnessMobile

final class ComposerDraftStorageTests: XCTestCase {
    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: ComposerDraftStorage.composeDraftKey)
        UserDefaults.standard.removeObject(forKey: ComposerDraftStorage.threadDraftsKey)
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
