import XCTest
@testable import HarnessMobile

final class PairingPayloadTests: XCTestCase {
    private let baseAccount = "acct123"
    private let baseBucket = "harness-sync"
    private let basePrefix = "harness/"
    private let baseAccess = "AKIAEXAMPLE"
    private let baseSecret = "secret-value"
    private let baseOpenAI = "sk-test"

    func testRoundTrip() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let encoded = try PairingPayload.encode(
            accountId: baseAccount,
            bucket: baseBucket,
            prefix: basePrefix,
            accessKeyId: baseAccess,
            secretAccessKey: baseSecret,
            openaiApiKey: baseOpenAI,
            now: now
        )
        XCTAssertTrue(encoded.hasPrefix(PairingPayload.prefix))
        let decoded = try PairingPayload.decode(encoded, now: now)
        XCTAssertEqual(decoded.accountId, baseAccount)
        XCTAssertEqual(decoded.bucket, baseBucket)
        XCTAssertEqual(decoded.prefix, basePrefix)
        XCTAssertEqual(decoded.accessKeyId, baseAccess)
        XCTAssertEqual(decoded.secretAccessKey, baseSecret)
        XCTAssertEqual(decoded.openaiApiKey, baseOpenAI)
        XCTAssertEqual(decoded.exp, now.timeIntervalSince1970 + PairingPayload.ttlSeconds)
    }

    func testAllowsEmptyOpenAIKey() throws {
        let now = Date(timeIntervalSince1970: 100)
        let encoded = try PairingPayload.encode(
            accountId: baseAccount,
            bucket: baseBucket,
            prefix: basePrefix,
            accessKeyId: baseAccess,
            secretAccessKey: baseSecret,
            openaiApiKey: "",
            now: now
        )
        let decoded = try PairingPayload.decode(encoded, now: now)
        XCTAssertEqual(decoded.openaiApiKey, "")
    }

    func testRejectsExpired() throws {
        let encoded = try PairingPayload.encode(
            accountId: baseAccount,
            bucket: baseBucket,
            prefix: basePrefix,
            accessKeyId: baseAccess,
            secretAccessKey: baseSecret,
            openaiApiKey: baseOpenAI,
            now: Date(timeIntervalSince1970: 100),
            exp: 50
        )
        XCTAssertThrowsError(try PairingPayload.decode(encoded, now: Date(timeIntervalSince1970: 100))) { error in
            XCTAssertEqual(error as? PairingPayload.DecodeError, .expired)
        }
    }

    func testRejectsBadPrefixAndVersion() throws {
        XCTAssertThrowsError(try PairingPayload.decode("nope")) { error in
            XCTAssertEqual(error as? PairingPayload.DecodeError, .badPrefix)
        }
        let json = #"{"v":2,"exp":999,"accountId":"a","bucket":"b","prefix":"p/","accessKeyId":"k","secretAccessKey":"s","openaiApiKey":""}"#
        let b64 = Data(json.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .trimmingCharacters(in: CharacterSet(charactersIn: "="))
        XCTAssertThrowsError(try PairingPayload.decode(PairingPayload.prefix + b64, now: Date(timeIntervalSince1970: 1))) { error in
            XCTAssertEqual(error as? PairingPayload.DecodeError, .badVersion)
        }
    }
}
