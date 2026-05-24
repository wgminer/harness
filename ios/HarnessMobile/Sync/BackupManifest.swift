import Foundation

struct BackupManifest: Codable, Equatable {
    var version: Int
    var revision: String
    var contentRevision: String?
    var updatedAt: Int64
    var bundleHash: String

    static func load(from url: URL) throws -> BackupManifest? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(BackupManifest.self, from: data)
    }

    func save(to url: URL) throws {
        let data = try JSONEncoder().encode(self)
        try BundleCodec.atomicWrite(data, to: url)
    }
}
