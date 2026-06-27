import XCTest
@testable import HarnessMobile

@MainActor
final class PendingSyncTrackerTests: XCTestCase {
    private var localDataDir: URL!
    private var cleanup: URL?

    override func setUpWithError() throws {
        PendingSyncTracker.clearBaseline()
        UserDefaults.standard.removeObject(forKey: SyncEngine.lastSyncedContentRevisionKey)

        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("HarnessMobileTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        localDataDir = temp.appendingPathComponent("local-data", isDirectory: true)
        cleanup = temp
        try LocalDataLayout.ensureDirectories(at: localDataDir)
    }

    override func tearDownWithError() throws {
        PendingSyncTracker.clearBaseline()
        UserDefaults.standard.removeObject(forKey: SyncEngine.lastSyncedContentRevisionKey)
        if let cleanup {
            try? FileManager.default.removeItem(at: cleanup)
        }
    }

    func testRefreshPendingSyncStateMatchesLastSyncedRevision() throws {
        try write("app-state/conversations.json", contents: "{\"a\":1}")
        let revision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            scopes: SyncScopes.userContentScopes
        )
        UserDefaults.standard.set(revision, forKey: SyncEngine.lastSyncedContentRevisionKey)

        let store = ConversationStore(localDataDir: localDataDir)
        try store.refreshPendingSyncState()

        XCTAssertFalse(store.hasLocalEdits)
    }

    func testRefreshPendingSyncStateDetectsDrift() throws {
        try write("app-state/conversations.json", contents: "{\"a\":1}")
        let syncedRevision = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            scopes: SyncScopes.userContentScopes
        )
        UserDefaults.standard.set(syncedRevision, forKey: SyncEngine.lastSyncedContentRevisionKey)

        try write("app-state/conversations.json", contents: "{\"a\":2}")

        let store = ConversationStore(localDataDir: localDataDir)
        try store.refreshPendingSyncState()

        XCTAssertTrue(store.hasLocalEdits)
    }

    private func write(_ relativePath: String, contents: String) throws {
        let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: relativePath)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try contents.data(using: .utf8)!.write(to: url, options: .atomic)
    }
}
