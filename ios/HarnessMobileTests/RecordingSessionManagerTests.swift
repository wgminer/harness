import XCTest
@testable import HarnessMobile

@MainActor
final class RecordingSessionManagerTests: XCTestCase {
    func testLiveActivityStopNotificationSetsFlag() {
        let manager = RecordingSessionManager()
        XCTAssertFalse(manager.liveActivityStopRequested)

        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        XCTAssertTrue(manager.liveActivityStopRequested)
    }

    func testAcknowledgeLiveActivityStopRequestClearsFlag() {
        let manager = RecordingSessionManager()
        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        XCTAssertTrue(manager.liveActivityStopRequested)

        manager.acknowledgeLiveActivityStopRequest()
        XCTAssertFalse(manager.liveActivityStopRequested)
    }

    func testCancelRecordingSessionClearsStopRequestWhileIdle() async {
        let manager = RecordingSessionManager()
        NotificationCenter.default.post(name: .dictationLiveActivityStopRequested, object: nil)
        XCTAssertTrue(manager.liveActivityStopRequested)

        await manager.cancelRecordingSession()

        XCTAssertFalse(manager.liveActivityStopRequested)
        XCTAssertFalse(manager.recorder.isRecording)
        XCTAssertEqual(manager.recorder.elapsedMs, 0)
    }

    func testCancelDuringStartDoesNotLeaveRecordingActive() async {
        let manager = RecordingSessionManager()
        manager.recorder.permissionProvider = {
            try? await Task.sleep(nanoseconds: 150_000_000)
            return true
        }

        let startTask = Task {
            try await manager.beginRecordingSession()
        }

        try? await Task.sleep(nanoseconds: 30_000_000)
        await manager.cancelRecordingSession()

        do {
            _ = try await startTask.value
            XCTFail("Expected start to fail after cancel")
        } catch is CancellationError {
            // Expected: cancel invalidated the in-flight start.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        XCTAssertFalse(manager.recorder.isRecording)
        XCTAssertEqual(manager.recorder.elapsedMs, 0)
    }

    func testOrphanedStartCleanupDoesNotCancelNewerSessionEpoch() async {
        let manager = RecordingSessionManager()
        var releasePermission: (() -> Void)?
        manager.recorder.permissionProvider = {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                releasePermission = { continuation.resume(returning: false) }
            }
        }

        let firstStart = Task {
            try await manager.beginRecordingSession()
        }

        try? await Task.sleep(nanoseconds: 20_000_000)
        await manager.cancelRecordingSession()

        // A newer begin should keep its epoch even if the orphaned start finishes cleanup.
        manager.recorder.permissionProvider = { false }
        let secondStart = Task {
            try await manager.beginRecordingSession()
        }

        releasePermission?()

        do {
            _ = try await firstStart.value
            XCTFail("First start should have been cancelled")
        } catch is CancellationError {
            // Expected
        } catch {
            XCTFail("Unexpected first-start error: \(error)")
        }

        do {
            _ = try await secondStart.value
            XCTFail("Second start should fail from denied permission")
        } catch let error as AudioRecorderError {
            XCTAssertEqual(error, .permissionDenied)
        } catch {
            XCTFail("Unexpected second-start error: \(error)")
        }

        XCTAssertFalse(manager.recorder.isRecording)
    }

    func testPrepareForDictationDoesNotStartCapture() {
        let manager = RecordingSessionManager()
        manager.prepareForDictation()
        XCTAssertFalse(manager.recorder.isRecording)
        XCTAssertEqual(manager.recorder.elapsedMs, 0)
        XCTAssertEqual(manager.recorder.audioLevel, 0)
    }

    func testCancelAfterBeginInvalidatesDeferredLiveActivitySession() async {
        let manager = RecordingSessionManager()
        manager.recorder.permissionProvider = { false }

        do {
            _ = try await manager.beginRecordingSession()
            XCTFail("Expected permission denial")
        } catch let error as AudioRecorderError {
            XCTAssertEqual(error, .permissionDenied)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        // Cancel bumps sessionID so any deferred LA start from a prior attempt is orphaned.
        await manager.cancelRecordingSession()
        XCTAssertFalse(manager.recorder.isRecording)
        XCTAssertFalse(manager.liveActivityStopRequested)
    }
}

@MainActor
final class AudioRecorderCancelTests: XCTestCase {
    func testCancelIsIdempotentWhenIdle() {
        let recorder = AudioRecorder()
        recorder.cancel()
        recorder.cancel()
        XCTAssertFalse(recorder.isRecording)
        XCTAssertEqual(recorder.elapsedMs, 0)
    }

    func testCancelDefaultsToIntentionalStop() {
        let recorder = AudioRecorder()
        recorder.cancel()
        XCTAssertTrue(recorder.intentionalStop)
        XCTAssertNil(recorder.preservedRecordingURL)
    }

    func testUnexpectedCancelClearsIntentionalStopFlag() {
        let recorder = AudioRecorder()
        recorder.cancel()
        XCTAssertTrue(recorder.intentionalStop)

        recorder.cancel(intentional: false)
        XCTAssertFalse(recorder.intentionalStop)
        XCTAssertFalse(recorder.isRecording)
    }

    func testUnexpectedCancelWithNoActiveTakeLeavesNoPreservedURL() {
        let recorder = AudioRecorder()
        recorder.cancel(intentional: false)
        XCTAssertNil(recorder.preservedRecordingURL)
        XCTAssertNil(recorder.consumePreservedRecordingURL())
        XCTAssertFalse(recorder.intentionalStop)
    }

    func testConsumePreservedRecordingURLTransfersOwnershipWithoutDeleting() throws {
        let recorder = AudioRecorder()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("preserved_rec_\(UUID().uuidString).m4a")
        try Data([1, 2, 3]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        recorder.testSeedPreservedRecordingURL(url)
        XCTAssertEqual(recorder.consumePreservedRecordingURL(), url)
        XCTAssertNil(recorder.preservedRecordingURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))

        // Intentional cancel after consume must not delete the UI-owned file.
        recorder.cancel()
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testIntentionalCancelDeletesUnconsumedPreservedURL() throws {
        let recorder = AudioRecorder()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("preserved_rec_\(UUID().uuidString).m4a")
        try Data([1, 2, 3]).write(to: url)

        recorder.testSeedPreservedRecordingURL(url)
        recorder.cancel()
        XCTAssertNil(recorder.preservedRecordingURL)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    func testCancelDuringPermissionWaitThrowsCancellation() async {
        let recorder = AudioRecorder()
        recorder.permissionProvider = {
            try? await Task.sleep(nanoseconds: 150_000_000)
            return true
        }

        let startTask = Task {
            try await recorder.start()
        }

        try? await Task.sleep(nanoseconds: 30_000_000)
        recorder.cancel()

        do {
            _ = try await startTask.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            // Expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        XCTAssertFalse(recorder.isRecording)
    }
}
