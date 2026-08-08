import XCTest
@testable import HarnessMobile

final class DictationSuggestedPromptsTests: XCTestCase {
    func testContractLoadsVocabulary() {
        let cfg = DictationSuggestedPrompts.contract
        XCTAssertEqual(cfg.vocabulary, ["Summarize", "Distill", "Breakdown", "Proofread"])
        XCTAssertEqual(cfg.runAction, "run")
        XCTAssertFalse(cfg.systemPrompt.isEmpty)
    }

    func testClampAcceptsVocabAndRun() {
        XCTAssertEqual(DictationSuggestedPrompts.clampAction(["action": "Distill"]), "Distill")
        XCTAssertEqual(DictationSuggestedPrompts.clampAction(["action": "run"]), "run")
        XCTAssertEqual(DictationSuggestedPrompts.clampAction(["action": "Continue"]), "run")
    }

    func testDisplayLabel() {
        XCTAssertEqual(DictationSuggestedPrompts.displayLabel(for: "run"), "Run")
        XCTAssertEqual(DictationSuggestedPrompts.displayLabel(for: "Proofread"), "Proofread")
    }
}
