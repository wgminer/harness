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

        let built = try BundleCodec.buildBundle(localDataDir: localDataDir)
        XCTAssertEqual(BundleCodec.hashBundleBytes(built.bytes), built.bundleHash)

        let dst = try makeEmptyLocalData()
        let doc = try BundleCodec.parseBundle(built.bytes)
        let written = try BundleCodec.extractBundle(localDataDir: dst, doc: doc)
        XCTAssertEqual(written, 2)

        let conv = try String(
            data: Data(contentsOf: LocalDataLayout.fileURL(in: dst, relativePath: "app-state/conversations.json")),
            encoding: .utf8
        )
        XCTAssertEqual(conv, "{\"keep\":\"me\"}")
    }

    func testBuildBundleRedactsSettingsSecrets() throws {
        try write(
            "settings/settings.json",
            contents: #"{"openai":{"apiKey":"secret-key"},"search":{"tavilyApiKey":"tvly"},"sync":{"bucket":"b"}}"#
        )
        try write("app-state/conversations.json", contents: "{}")

        let built = try BundleCodec.buildBundle(localDataDir: localDataDir)
        let doc = try BundleCodec.parseBundle(built.bytes)
        let settingsEntry = doc.entries.first { $0.path == "settings/settings.json" }
        XCTAssertNotNil(settingsEntry)
        let settingsData = Data(base64Encoded: settingsEntry!.contents)
        let parsed = try JSONSerialization.jsonObject(with: XCTUnwrap(settingsData)) as? [String: Any]
        let openai = parsed?["openai"] as? [String: Any]
        let search = parsed?["search"] as? [String: Any]
        XCTAssertNil(openai?["apiKey"])
        XCTAssertNil(search?["tavilyApiKey"])
        XCTAssertNotNil(parsed?["sync"])
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
        let passthrough = PassthroughStore(localDataDir: localDataDir)
        try passthrough.replace(with: doc, bundleHash: "hash-1")

        let withoutNote = try BundleCodec.computeRevision(localDataDir: localDataDir)
        let withNote = try BundleCodec.computeRevision(
            localDataDir: localDataDir,
            fallbackDir: passthrough.filesDir
        )
        XCTAssertNotEqual(withoutNote, withNote)

        let both = try BundleCodec.computeSyncRevisions(
            localDataDir: localDataDir,
            fallbackDir: passthrough.filesDir
        )
        XCTAssertEqual(both.revision, withNote)
        XCTAssertEqual(
            both.contentRevision,
            try BundleCodec.computeRevision(
                localDataDir: localDataDir,
                scopes: SyncScopes.userContentScopes,
                fallbackDir: passthrough.filesDir
            )
        )
    }

    func testPassthroughStoreHoldsOnlyRelayedFilesAndRoundTripsThroughPush() throws {
        try write("app-state/conversations.json", contents: "{\"a\":1}")
        try write("settings/settings.json", contents: "{\"version\":1}")

        let image = Data((0 ..< 5000).map { UInt8($0 % 251) })
        let note = Data("# Note \"quoted\"\nhello".utf8)
        let doc = BundleDocument(
            version: SyncScopes.bundleFormatVersion,
            entries: [
                BundleEntry(
                    path: "app-state/conversations.json",
                    contents: Data("{\"a\":1}".utf8).base64EncodedString(),
                    size: 7
                ),
                BundleEntry(path: "app-state/images/pic.png", contents: image.base64EncodedString(), size: image.count),
                BundleEntry(
                    path: "app-state/chat-attachments/conv_1/desktop.jpg",
                    contents: image.base64EncodedString(),
                    size: image.count
                ),
                BundleEntry(path: "app-state/notes/trip.md", contents: note.base64EncodedString(), size: note.count),
            ]
        )
        let passthrough = PassthroughStore(localDataDir: localDataDir)
        XCTAssertNil(passthrough.bundleHash())
        try passthrough.replace(with: doc, bundleHash: "hash-1")
        XCTAssertEqual(passthrough.bundleHash(), "hash-1")
        XCTAssertTrue(passthrough.contains("app-state/images/pic.png"))
        XCTAssertTrue(passthrough.contains("app-state/chat-attachments/conv_1/desktop.jpg"))
        XCTAssertFalse(passthrough.contains("app-state/conversations.json"))

        // A pull keeps relayed files out of local-data.
        try BundleCodec.extractBundle(localDataDir: localDataDir, doc: doc)
        for rel in ["app-state/images/pic.png", "app-state/chat-attachments/conv_1/desktop.jpg"] {
            XCTAssertFalse(
                FileManager.default.fileExists(atPath: LocalDataLayout.fileURL(in: localDataDir, relativePath: rel).path)
            )
        }

        // A push hands every one of them back, byte for byte.
        let built = try BundleCodec.buildBundle(localDataDir: localDataDir, fallbackDir: passthrough.filesDir)
        XCTAssertEqual(BundleCodec.hashBundleBytes(built.bytes), built.bundleHash)
        let pushed = BundleCodec.entryDataMap(from: try BundleCodec.parseBundle(built.bytes))
        XCTAssertEqual(built.entryCount, pushed.count)
        XCTAssertEqual(pushed["app-state/images/pic.png"], image)
        XCTAssertEqual(pushed["app-state/chat-attachments/conv_1/desktop.jpg"], image)
        XCTAssertEqual(pushed["app-state/notes/trip.md"], note)
        XCTAssertEqual(pushed["app-state/conversations.json"], Data("{\"a\":1}".utf8))

        // A missing relayed file invalidates the store, which forces a fresh download.
        try FileManager.default.removeItem(
            at: LocalDataLayout.fileURL(in: passthrough.filesDir, relativePath: "app-state/images/pic.png")
        )
        XCTAssertNil(passthrough.bundleHash())
    }

    func testAttachmentsCreatedOnThisPhoneStayLocal() throws {
        let rel = "app-state/chat-attachments/conv_\(UUID().uuidString)/mine.jpg"
        XCTAssertFalse(SyncScopes.materializesLocally(rel))
        XCTAssertTrue(SyncScopes.isPassthroughBlob(rel))
        LocalAttachmentIndex.insert(rel)
        XCTAssertTrue(SyncScopes.materializesLocally(rel))
        XCTAssertFalse(SyncScopes.isPassthroughBlob(rel))
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
