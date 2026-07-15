import XCTest
@testable import HarnessMobile

final class ToolResultJSONTests: XCTestCase {
    func testEncodeErrorSerializesErrorKey() {
        let raw = ToolResultJSON.encodeError("tool failed")
        let data = raw.data(using: .utf8)!
        let object = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(object["error"] as? String, "tool failed")
    }

    func testMaxToolCallIterationsMatchesRustCap() {
        XCTAssertEqual(OpenAIClient.maxToolCallIterations, 10)
    }
}
