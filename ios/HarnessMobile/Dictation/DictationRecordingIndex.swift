import Foundation

/// Local-only map from dictation conversation id → recording filename under Documents/recordings/.
enum DictationRecordingIndex {
    private static let indexFileName = "dictation_recordings.json"

    static func link(conversationId: String, recordingURL: URL) throws {
        let filename = recordingURL.lastPathComponent
        var map = loadMap()
        map[conversationId] = filename
        try saveMap(map)
    }

    static func recordingURL(for conversationId: String) -> URL? {
        guard let filename = loadMap()[conversationId] else { return nil }
        guard let dir = try? RecordingStorage.recordingsDirectory() else { return nil }
        let url = dir.appendingPathComponent(filename)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func unlink(conversationId: String) {
        var map = loadMap()
        guard map.removeValue(forKey: conversationId) != nil else { return }
        try? saveMap(map)
    }

    private static func indexFileURL() throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("recordings", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(indexFileName)
    }

    private static func loadMap() -> [String: String] {
        guard let url = try? indexFileURL(),
              let data = try? Data(contentsOf: url),
              let map = try? JSONDecoder().decode([String: String].self, from: data)
        else {
            return [:]
        }
        return map
    }

    private static func saveMap(_ map: [String: String]) throws {
        let url = try indexFileURL()
        let data = try JSONEncoder().encode(map)
        try data.write(to: url, options: .atomic)
    }
}
