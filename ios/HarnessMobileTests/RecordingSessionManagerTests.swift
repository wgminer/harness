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
