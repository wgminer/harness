import XCTest
@testable import HarnessMobile

final class BundleCodecTests: XCTestCase {
    private var localDataDir: URL!
    private var cleanup: URL?

    override func setUpWithError() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("HarnessMobileTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        localDataDir = temp.appendingPathComponent("local-data", isDirectory: true)
        cleanup = temp
        try LocalDataLayout.ensureDirectories(at: localDataDir)
    }

    override func tearDownWithError() throws {
        if let cleanup {
            try? FileManager.default.removeItem(at: cleanup)
        }
    }

    func testComputeRevisionMatchesDesktopFixture() throws {
        try write(
            "app-state/conversations.json",
            contents: "{\"a\":1}"
        )
        try write(
            "settings/settings.json",
            contents: "{\"version\":1}"
        )
        let revision = try BundleCodec.computeRevision(localDataDir: localDataDir)
        XCTAssertEqual(
            revision,
            "871a3ac43c56aec72a9a93a9ab2122e31bcb3e431e34d6339a7bf4db72425387"
        )
    }

    func testBuildParseRoundTrip() throws {
        try write("app-state/conversations.json", contents: "{\"keep\":\"me\"}")
        try write("settings/settings.json", contents: "{\"version\":1}")
        try write("themes/active.json", contents: "{\"accent\":\"#000\"}")

        let built = try BundleCodec.buildBundle(localDataDir: localDataDir)
        XCTAssertEqual(BundleCodec.hashBundleBytes(built.bytes), built.bundleHash)

        let dst = try makeEmptyLocalData()
        let doc = try BundleCodec.parseBundle(built.bytes)
        let written = try BundleCodec.extractBundle(localDataDir: dst, doc: doc)
        XCTAssertEqual(written, 3)

        let conv = try String(
            data: Data(contentsOf: LocalDataLayout.fileURL(in: dst, relativePath: "app-state/conversations.json")),
            encoding: .utf8
        )
        XCTAssertEqual(conv, "{\"keep\":\"me\"}")
    }

    func testRevisionChangesWhenContentChanges() throws {
        try write("app-state/conversations.json", contents: "{\"a\":1}")
        let before = try BundleCodec.computeRevision(localDataDir: localDataDir)
        try write("app-state/conversations.json", contents: "{\"a\":2}")
        let after = try BundleCodec.computeRevision(localDataDir: localDataDir)
        XCTAssertNotEqual(before, after)
    }

    func testRevisionUsesRemoteBundleFallbackForDesktopNotes() throws {
        try write("app-state/conversations.json", contents: "{\"a\":1}")
        try write("settings/settings.json", contents: "{\"version\":1}")

        let noteData = Data("# Note\nhello".utf8)
        let doc = BundleDocument(
            version: SyncScopes.bundleFormatVersion,
            entries: [
                BundleEntry(
                    path: "app-state/conversations.json",
                    contents: Data("{\"a\":1}".utf8).base64EncodedString(),
                    size: 5
                ),
                BundleEntry(
                    path: "settings/settings.json",
                    contents: Data("{\"version\":1}".utf8).base64EncodedString(),
                    size: 14
                ),
                BundleEntry(
                    path: "app-state/notes/trip.md",
                    contents: noteData.base64EncodedString(),
                    size: noteData.count
                ),
            ]
        )
        let fallback = BundleCodec.entryDataMap(from: doc)

        let withoutNote = try BundleCodec.computeRevision(localDataDir: localDataDir)
        let withNote = try BundleCodec.computeRevision(localDataDir: localDataDir, fallbackData: fallback)
        XCTAssertNotEqual(withoutNote, withNote)
    }

    func testExtractBundleSkipsDesktopNotesLocally() throws {
        let noteData = Data("# Note\nhello".utf8)
        let doc = BundleDocument(
            version: SyncScopes.bundleFormatVersion,
            entries: [
                BundleEntry(
                    path: "app-state/conversations.json",
                    contents: Data("{}".utf8).base64EncodedString(),
                    size: 2
                ),
                BundleEntry(
                    path: "app-state/notes/trip.md",
                    contents: noteData.base64EncodedString(),
                    size: noteData.count
                ),
            ]
        )

        let written = try BundleCodec.extractBundle(localDataDir: localDataDir, doc: doc)
        XCTAssertEqual(written, 1)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: LocalDataLayout.fileURL(in: localDataDir, relativePath: "app-state/notes/trip.md").path
            )
        )
    }

    func testSyncDecisionConflict() {
        let decision = SyncDecisionEngine.decide(params: (
            localRevision: "local",
            remoteRevision: "remote",
            lastSyncedRevision: "ancestor",
            remoteUpdatedAt: 1000,
            localMaxMtimeMs: 2000
        ))
        XCTAssertEqual(decision, .conflict)
    }

    func testSyncDecisionPullWhenOnlyRemoteChanged() {
        let decision = SyncDecisionEngine.decide(params: (
            localRevision: "ancestor",
            remoteRevision: "remote",
            lastSyncedRevision: "ancestor",
            remoteUpdatedAt: 1000,
            localMaxMtimeMs: 500
        ))
        XCTAssertEqual(decision, .pull)
    }

    // MARK: - Helpers

    private func write(_ rel: String, contents: String) throws {
        let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try contents.write(to: url, atomically: true, encoding: .utf8)
    }

    func testRelativePathNormalizesPrivateVarPrefix() throws {
        let base = URL(fileURLWithPath: "/var/mobile/Containers/Data/local-data", isDirectory: true)
        let file = URL(fileURLWithPath: "/private/var/mobile/Containers/Data/local-data/app-state/conversations.json")
        XCTAssertEqual(
            LocalDataLayout.relativePath(from: base, to: file),
            "app-state/conversations.json"
        )
    }

    private func makeEmptyLocalData() throws -> URL {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("HarnessMobileTests-dst-\(UUID().uuidString)", isDirectory: true)
        let dir = temp.appendingPathComponent("local-data", isDirectory: true)
        try LocalDataLayout.ensureDirectories(at: dir)
        return dir
    }
}
