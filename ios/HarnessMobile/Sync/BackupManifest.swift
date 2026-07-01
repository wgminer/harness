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
        return load(fromData: data)
    }

    static func load(fromData data: Data) -> BackupManifest? {
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let revision = raw["revision"] as? String,
              let updatedAt = raw["updatedAt"] as? Int64 ?? (raw["updatedAt"] as? Int).map(Int64.init),
              let bundleHash = raw["bundleHash"] as? String,
              let version = raw["version"] as? Int else {
            return nil
        }
        let contentRevision = raw["contentRevision"] as? String
        return BackupManifest(
            version: version,
            revision: revision,
            contentRevision: contentRevision,
            updatedAt: updatedAt,
            bundleHash: bundleHash
        )
    }

    func save(to url: URL) throws {
        let data = try JSONEncoder().encode(self)
        try BundleCodec.atomicWrite(data, to: url)
    }
}
