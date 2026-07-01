import XCTest
@testable import HarnessMobile

final class RemoteBackupStoreTests: XCTestCase {
    func testObjectKeyNormalizesPrefix() {
        XCTAssertEqual(
            RemoteBackupStore.objectKey(prefix: "harness/", name: SyncScopes.manifestFileName),
            "harness/manifest.json"
        )
        XCTAssertEqual(
            RemoteBackupStore.objectKey(prefix: "/custom/", name: SyncScopes.bundleFileName),
            "custom/bundle.json.gz"
        )
    }

    func testR2EndpointUsesAccountId() {
        XCTAssertEqual(
            RemoteBackupStore.r2Endpoint(accountId: "abc123"),
            "https://abc123.r2.cloudflarestorage.com"
        )
    }

    func testBackupManifestLoadFromData() {
        let json = Data(
            """
            {
              "version": 1,
              "revision": "rev1",
              "contentRevision": "content1",
              "updatedAt": 1234,
              "bundleHash": "hash"
            }
            """.utf8
        )
        let manifest = BackupManifest.load(fromData: json)
        XCTAssertEqual(manifest?.version, 1)
        XCTAssertEqual(manifest?.revision, "rev1")
        XCTAssertEqual(manifest?.contentRevision, "content1")
        XCTAssertEqual(manifest?.updatedAt, 1234)
        XCTAssertEqual(manifest?.bundleHash, "hash")
    }

    func testMakeConfiguredThrowsWhenIncomplete() {
        XCTAssertThrowsError(try RemoteBackupStore.makeConfigured()) { error in
            XCTAssertEqual(error as? RemoteBackupStoreError, .notConfigured)
        }
    }
}
