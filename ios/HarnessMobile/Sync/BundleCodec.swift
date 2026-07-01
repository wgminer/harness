import CryptoKit
import Foundation
import zlib

struct BundleEntry: Codable, Equatable {
    let path: String
    let contents: String
    let size: Int
}

struct BundleDocument: Codable, Equatable {
    let version: Int
    let entries: [BundleEntry]
}

struct BuiltBundle: Equatable {
    let bytes: Data
    let bundleHash: String
    let entries: [BundleEntry]
}

enum BundleCodecError: LocalizedError {
    case malformed
    case unsupportedVersion(Int)
    case sizeMismatch(String)
    case gzipFailed

    var errorDescription: String? {
        switch self {
        case .malformed:
            return "Bundle is malformed."
        case .unsupportedVersion(let v):
            return "Unsupported bundle version: \(v)"
        case .sizeMismatch(let path):
            return "Bundle entry size mismatch for \(path)"
        case .gzipFailed:
            return "Failed to decompress bundle."
        }
    }
}

enum BundleCodec {
    static func listScopedFiles(
        localDataDir: URL,
        scopes: [SyncScopes.Scope] = SyncScopes.defaultScopes,
        supplementalPaths: [String] = []
    ) throws -> [String] {
        var all = Set<String>()
        for scope in scopes {
            let abs = LocalDataLayout.fileURL(in: localDataDir, relativePath: scope.relPath)
            switch scope.kind {
            case .file:
                if FileManager.default.fileExists(atPath: abs.path) {
                    all.insert(scope.relPath)
                }
            case .directory:
                for path in try walkFiles(root: abs, base: localDataDir) {
                    all.insert(path)
                }
            }
        }
        for path in supplementalPaths where SyncScopes.isInScope(path, scopes: scopes) {
            all.insert(path)
        }
        return all.sorted()
    }

    static func entryDataMap(from doc: BundleDocument) -> [String: Data] {
        var map: [String: Data] = [:]
        for entry in doc.entries {
            guard let data = Data(base64Encoded: entry.contents), data.count == entry.size else { continue }
            map[entry.path] = data
        }
        return map
    }

    private static func readScopedFileData(
        localDataDir: URL,
        relativePath: String,
        fallbackData: [String: Data]
    ) throws -> Data {
        let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: relativePath)
        if let data = try? LocalDataLayout.readRegularFileData(at: url) {
            return data
        }
        if let data = fallbackData[relativePath] {
            return data
        }
        throw LocalDataLayoutError.unreadableFile(url.lastPathComponent)
    }

    private static func walkFiles(root: URL, base: URL) throws -> [String] {
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        var out: [String] = []
        let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )
        while let url = enumerator?.nextObject() as? URL {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { continue }
            guard let rel = LocalDataLayout.relativePath(from: base, to: url) else { continue }
            out.append(rel.replacingOccurrences(of: "\\", with: "/"))
        }
        return out.sorted()
    }

    static func computeRevision(
        localDataDir: URL,
        scopes: [SyncScopes.Scope] = SyncScopes.defaultScopes,
        fallbackData: [String: Data] = [:]
    ) throws -> String {
        let files = try listScopedFiles(
            localDataDir: localDataDir,
            scopes: scopes,
            supplementalPaths: Array(fallbackData.keys)
        )
        var hasher = SHA256()
        for rel in files {
            let data = try readScopedFileData(
                localDataDir: localDataDir,
                relativePath: rel,
                fallbackData: fallbackData
            )
            hasher.update(data: Data(rel.utf8))
            hasher.update(data: Data([0]))
            hasher.update(data: data)
            hasher.update(data: Data([0]))
        }
        return hasher.finalize().hexString
    }

    static func computeContentRevisionFromBundle(_ doc: BundleDocument) -> String {
        var hasher = SHA256()
        let entries = doc.entries
            .filter { SyncScopes.isInScope($0.path, scopes: SyncScopes.userContentScopes) }
            .sorted { $0.path < $1.path }
        for entry in entries {
            guard let data = Data(base64Encoded: entry.contents), data.count == entry.size else { continue }
            hasher.update(data: Data(entry.path.utf8))
            hasher.update(data: Data([0]))
            hasher.update(data: data)
            hasher.update(data: Data([0]))
        }
        return hasher.finalize().hexString
    }

    static func computeLocalMaxMtime(localDataDir: URL, scopes: [SyncScopes.Scope] = SyncScopes.defaultScopes) throws -> Int64 {
        let files = try listScopedFiles(localDataDir: localDataDir, scopes: scopes)
        var maxMtime: Int64 = 0
        for rel in files {
            let url = LocalDataLayout.fileURL(in: localDataDir, relativePath: rel)
            let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
            if let mtime = attrs[.modificationDate] as? Date {
                let ms = Int64(mtime.timeIntervalSince1970 * 1000)
                if ms > maxMtime { maxMtime = ms }
            }
        }
        return maxMtime
    }

    static func buildBundle(
        localDataDir: URL,
        scopes: [SyncScopes.Scope] = SyncScopes.defaultScopes,
        passthroughData: [String: Data] = [:]
    ) throws -> BuiltBundle {
        let files = try listScopedFiles(
            localDataDir: localDataDir,
            scopes: scopes,
            supplementalPaths: Array(passthroughData.keys)
        )
        var entries: [BundleEntry] = []
        for rel in files {
            var data = try readScopedFileData(
                localDataDir: localDataDir,
                relativePath: rel,
                fallbackData: passthroughData
            )
            if rel == "settings/settings.json" {
                data = SettingsSecrets.redactSettingsJsonBytes(data)
            }
            entries.append(BundleEntry(
                path: rel,
                contents: data.base64EncodedString(),
                size: data.count
            ))
        }
        let doc = BundleDocument(version: SyncScopes.bundleFormatVersion, entries: entries)
        let json = try JSONEncoder().encode(doc)
        guard let gzipped = gzipEncode(json) else {
            throw BundleCodecError.gzipFailed
        }
        let bundleHash = SHA256.hash(data: gzipped).hexString
        return BuiltBundle(bytes: gzipped, bundleHash: bundleHash, entries: entries)
    }

    static func parseBundleFromEntryMap(_ entryMap: [String: Data]) -> BundleDocument {
        let entries = entryMap.keys.sorted().map { path in
            let data = entryMap[path] ?? Data()
            return BundleEntry(
                path: path,
                contents: data.base64EncodedString(),
                size: data.count
            )
        }
        return BundleDocument(version: SyncScopes.bundleFormatVersion, entries: entries)
    }

    static func buildBundleBytes(from entryMap: [String: Data]) throws -> Data {
        let doc = parseBundleFromEntryMap(entryMap)
        let json = try JSONEncoder().encode(doc)
        guard let gzipped = gzipEncode(json) else {
            throw BundleCodecError.gzipFailed
        }
        return gzipped
    }

    static func parseBundle(_ bytes: Data) throws -> BundleDocument {
        guard let json = gzipDecode(bytes) else {
            throw BundleCodecError.gzipFailed
        }
        let doc = try JSONDecoder().decode(BundleDocument.self, from: json)
        guard doc.version == SyncScopes.bundleFormatVersion else {
            throw BundleCodecError.unsupportedVersion(doc.version)
        }
        return doc
    }

    static func hashBundleBytes(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).hexString
    }

    @discardableResult
    static func extractBundle(
        localDataDir: URL,
        doc: BundleDocument,
        scopes: [SyncScopes.Scope] = SyncScopes.defaultScopes
    ) throws -> Int {
        let fm = FileManager.default
        for scope in scopes {
            let abs = LocalDataLayout.fileURL(in: localDataDir, relativePath: scope.relPath)
            guard fm.fileExists(atPath: abs.path) else { continue }
            try fm.removeItem(at: abs)
        }
        var count = 0
        for entry in doc.entries where SyncScopes.isInScope(entry.path, scopes: scopes) {
            guard SyncScopes.materializesLocally(entry.path) else { continue }
            guard let data = Data(base64Encoded: entry.contents) else {
                throw BundleCodecError.malformed
            }
            if data.count != entry.size {
                throw BundleCodecError.sizeMismatch(entry.path)
            }
            let abs = LocalDataLayout.fileURL(in: localDataDir, relativePath: entry.path)
            try fm.createDirectory(at: abs.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: abs, options: .atomic)
            count += 1
        }
        return count
    }

    static func atomicWrite(_ data: Data, to url: URL) throws {
        let tmp = url.appendingPathExtension("tmp")
        try data.write(to: tmp, options: .atomic)
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) {
            try fm.removeItem(at: url)
        }
        try fm.moveItem(at: tmp, to: url)
    }

    // MARK: - gzip (RFC 1952, compatible with Node `gzipSync`)

    private static func gzipEncode(_ data: Data) -> Data? {
        var stream = z_stream()
        var status = deflateInit2_(
            &stream,
            Z_BEST_COMPRESSION,
            Z_DEFLATED,
            MAX_WBITS + 16,
            MAX_MEM_LEVEL,
            Z_DEFAULT_STRATEGY,
            ZLIB_VERSION,
            Int32(MemoryLayout<z_stream>.size)
        )
        guard status == Z_OK else { return nil }
        defer { deflateEnd(&stream) }

        var output = Data()
        let chunk = 16_384
        return data.withUnsafeBytes { inputRaw -> Data? in
            guard let inputBase = inputRaw.bindMemory(to: Bytef.self).baseAddress else { return nil }
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: inputBase)
            stream.avail_in = uInt(data.count)

            var buffer = [UInt8](repeating: 0, count: chunk)
            repeat {
                stream.next_out = UnsafeMutablePointer<Bytef>(&buffer)
                stream.avail_out = uInt(chunk)
                status = deflate(&stream, Z_FINISH)
                guard status == Z_OK || status == Z_STREAM_END else { return nil }
                let have = chunk - Int(stream.avail_out)
                if have > 0 { output.append(buffer, count: have) }
            } while status != Z_STREAM_END
            return output
        }
    }

    private static func gzipDecode(_ data: Data) -> Data? {
        var stream = z_stream()
        var status = inflateInit2_(&stream, MAX_WBITS + 32, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { return nil }
        defer { inflateEnd(&stream) }

        var output = Data()
        let chunk = 16_384
        return data.withUnsafeBytes { inputRaw -> Data? in
            guard let inputBase = inputRaw.bindMemory(to: Bytef.self).baseAddress else { return nil }
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: inputBase)
            stream.avail_in = uInt(data.count)

            var buffer = [UInt8](repeating: 0, count: chunk)
            repeat {
                stream.next_out = UnsafeMutablePointer<Bytef>(&buffer)
                stream.avail_out = uInt(chunk)
                status = inflate(&stream, Z_NO_FLUSH)
                guard status == Z_OK || status == Z_STREAM_END else { return nil }
                let have = chunk - Int(stream.avail_out)
                if have > 0 { output.append(buffer, count: have) }
            } while status != Z_STREAM_END
            return output
        }
    }
}

private extension SHA256.Digest {
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
