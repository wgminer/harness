import AVFoundation
import Foundation

struct VoiceRecording: Identifiable, Equatable {
    let url: URL
    let recordedAt: Date
    let duration: TimeInterval?

    var id: String { url.lastPathComponent }
}

enum RecordingStorage {
    static let maxRecordingDuration: TimeInterval = 5 * 60
    private static let audioExtensions: Set<String> = ["m4a", "wav", "mp3", "caf", "aac", "qta"]

    static func recordingsDirectory() throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("recordings", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var displayPath: String {
        "Documents/recordings/"
    }

    static func newRecordingURL(extension ext: String = "m4a") throws -> URL {
        let dir = try recordingsDirectory()
        return dir.appendingPathComponent("rec_\(Int64(Date().timeIntervalSince1970 * 1000)).\(ext)")
    }

    /// Copy an imported voice memo into local recordings storage.
    static func importRecording(from sourceURL: URL) throws -> URL {
        let ext = sourceURL.pathExtension.isEmpty ? "m4a" : sourceURL.pathExtension
        let destination = try newRecordingURL(extension: ext)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return destination
    }

    static func listRecordings(limit: Int? = nil) throws -> [VoiceRecording] {
        let dir = try recordingsDirectory()
        let urls = try FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .creationDateKey],
            options: [.skipsHiddenFiles]
        )

        let recordings = urls.compactMap { url -> VoiceRecording? in
            guard audioExtensions.contains(url.pathExtension.lowercased()) else { return nil }
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .creationDateKey])
            let fallbackDate = values?.contentModificationDate ?? values?.creationDate ?? Date.distantPast
            let recordedAt = parseTimestamp(from: url.lastPathComponent) ?? fallbackDate
            return VoiceRecording(url: url, recordedAt: recordedAt, duration: duration(for: url))
        }
        .sorted { $0.recordedAt > $1.recordedAt }

        guard let limit else { return recordings }
        return Array(recordings.prefix(limit))
    }

    static func recordingCount() throws -> Int {
        try listRecordings().count
    }

    static func parseTimestamp(from filename: String) -> Date? {
        guard filename.hasPrefix("rec_") else { return nil }
        let stem = (filename as NSString).deletingPathExtension
        let millisPart = stem.dropFirst(4)
        guard let millis = Int64(millisPart) else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
    }

    static func duration(for url: URL) -> TimeInterval? {
        let asset = AVURLAsset(url: url)
        let time = asset.duration
        guard time.isValid, !time.isIndefinite else { return nil }
        let seconds = CMTimeGetSeconds(time)
        guard seconds.isFinite, seconds > 0 else { return nil }
        return seconds
    }

    static func formattedDuration(_ duration: TimeInterval) -> String {
        let total = Int(duration.rounded())
        let minutes = total / 60
        let seconds = total % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
