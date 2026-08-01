import XCTest
@testable import HarnessMobile

final class ChatStreamBatchTests: XCTestCase {
    func testDefaultsLoadFromBundledContract() {
        let policy = ChatStreamBatchPolicy.defaults
        XCTAssertGreaterThan(policy.minChars, 0)
        XCTAssertGreaterThan(policy.maxHoldMs, 0)
        XCTAssertGreaterThan(policy.newlineMinChars, 0)
        XCTAssertLessThan(policy.newlineMinChars, policy.minChars)
    }

    func testHoldsSmallDeltasUntilMinChars() {
        let policy = ChatStreamBatchPolicy(minChars: 150, maxHoldMs: 350, newlineMinChars: 40)
        var batcher = StreamTextBatcher(policy: policy)
        XCTAssertNil(batcher.push("hello "))
        XCTAssertNil(batcher.push("world"))
        XCTAssertEqual(batcher.pending, "hello world")
    }

    func testFlushesWhenMinCharsReached() {
        let policy = ChatStreamBatchPolicy(minChars: 150, maxHoldMs: 350, newlineMinChars: 40)
        var batcher = StreamTextBatcher(policy: policy)
        let chunk = String(repeating: "a", count: 150)
        XCTAssertEqual(batcher.push(chunk), chunk)
        XCTAssertEqual(batcher.pending, "")
    }

    func testFlushesThroughLastNewlineOnceNewlineMinMet() {
        let policy = ChatStreamBatchPolicy(minChars: 150, maxHoldMs: 350, newlineMinChars: 40)
        var batcher = StreamTextBatcher(policy: policy)
        let para = String(repeating: "x", count: 38) + "\n"
        XCTAssertNil(batcher.push(para))
        XCTAssertEqual(batcher.push("y\ntrailing"), para + "y\n")
        XCTAssertEqual(batcher.pending, "trailing")
    }

    func testForceFlushReturnsRemainder() {
        let policy = ChatStreamBatchPolicy(minChars: 150, maxHoldMs: 350, newlineMinChars: 40)
        var batcher = StreamTextBatcher(policy: policy)
        _ = batcher.push("partial")
        XCTAssertEqual(batcher.flush(), "partial")
        XCTAssertNil(batcher.flush())
    }
}
