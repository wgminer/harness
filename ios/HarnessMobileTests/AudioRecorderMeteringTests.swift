import XCTest
@testable import HarnessMobile

final class AudioRecorderMeteringTests: XCTestCase {
    func testNormalizedLevelBelowFloorIsSilence() {
        XCTAssertEqual(AudioRecorderMetering.normalizedLevel(fromDecibels: -80), 0)
        XCTAssertEqual(
            AudioRecorderMetering.normalizedLevel(fromDecibels: AudioRecorderMetering.silenceFloor),
            0
        )
    }

    func testNormalizedLevelAtOrAboveCeilingIsFull() {
        let atCeiling = AudioRecorderMetering.normalizedLevel(
            fromDecibels: AudioRecorderMetering.speechCeiling
        )
        let aboveCeiling = AudioRecorderMetering.normalizedLevel(fromDecibels: -1)
        XCTAssertEqual(atCeiling, 1, accuracy: 0.001)
        XCTAssertEqual(aboveCeiling, 1, accuracy: 0.001)
    }

    func testNormalizedLevelIsMonotonicInRange() {
        let low = AudioRecorderMetering.normalizedLevel(fromDecibels: -45)
        let mid = AudioRecorderMetering.normalizedLevel(fromDecibels: -30)
        let high = AudioRecorderMetering.normalizedLevel(fromDecibels: -18)
        XCTAssertGreaterThan(mid, low)
        XCTAssertGreaterThan(high, mid)
        XCTAssertGreaterThan(low, 0)
        XCTAssertLessThan(high, 1)
    }

    func testSmoothAttackRisesFasterThanReleaseFalls() {
        let from: Float = 0.2
        let up = AudioRecorderMetering.smooth(current: from, toward: 0.8)
        let down = AudioRecorderMetering.smooth(current: from, toward: 0.0)
        let attackDelta = up - from
        let releaseDelta = from - down
        XCTAssertGreaterThan(attackDelta, releaseDelta)
        XCTAssertGreaterThan(up, from)
        XCTAssertLessThan(down, from)
    }

    func testAppendSampleKeepsFixedWindowLength() {
        let count = AudioRecorderMetering.waveformSampleCount
        var samples: [CGFloat] = []
        for value in 1 ... count {
            samples = AudioRecorderMetering.appendSample(CGFloat(value), to: samples)
            XCTAssertLessThanOrEqual(samples.count, count)
        }
        XCTAssertEqual(samples.count, count)
        XCTAssertEqual(samples.first, 1)
        XCTAssertEqual(samples.last, CGFloat(count))

        samples = AudioRecorderMetering.appendSample(CGFloat(count + 1), to: samples)
        XCTAssertEqual(samples.count, count)
        XCTAssertEqual(samples.first, 2)
        XCTAssertEqual(samples.last, CGFloat(count + 1))
    }

    func testWaveformSampleCountMatchesRecorder() {
        XCTAssertEqual(AudioRecorder.waveformSampleCount, AudioRecorderMetering.waveformSampleCount)
        XCTAssertEqual(AudioRecorderMetering.waveformSampleCount, 32)
    }
}
