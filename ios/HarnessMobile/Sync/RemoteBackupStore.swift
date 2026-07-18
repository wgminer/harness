import AsyncHTTPClient
import Foundation
import NIOCore
import SotoCore
import SotoS3

struct R2Config: Sendable {
    let accountId: String
    let bucket: String
    let prefix: String
    let accessKeyId: String
    let secretAccessKey: String
}

enum RemoteBackupStoreError: LocalizedError {
    case notConfigured
    case invalidManifest

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Cloudflare R2 is not configured."
        case .invalidManifest:
            return "Remote backup manifest is invalid."
        }
    }
}

/// Cloudflare R2 remote backup (S3-compatible API).
/// Stores `bundle.json.gz` + `manifest.json` under a configurable prefix.
final class RemoteBackupStore: @unchecked Sendable {
    private let s3: S3
    private let bucket: String
    private let prefix: String
    private let awsClient: AWSClient
    /// Owned client with HTTP decompression disabled.
    /// `HTTPClient.shared` enables gzip and fails on precompressed `bundle.json.gz` from R2
    /// (`NIOHTTPDecompression.ExtraDecompressionError`).
    private let httpClient: HTTPClient

    init(config: R2Config) {
        bucket = config.bucket.trimmingCharacters(in: .whitespacesAndNewlines)
        prefix = R2SettingsStore.normalizePrefix(config.prefix)
        httpClient = HTTPClient(
            eventLoopGroupProvider: .singleton,
            configuration: HTTPClient.Configuration(decompression: .disabled)
        )
        awsClient = AWSClient(
            credentialProvider: .static(
                accessKeyId: config.accessKeyId.trimmingCharacters(in: .whitespacesAndNewlines),
                secretAccessKey: config.secretAccessKey
            ),
            httpClient: httpClient
        )
        let endpoint = Self.r2Endpoint(accountId: config.accountId)
        s3 = S3(
            client: awsClient,
            region: .other("auto"),
            endpoint: endpoint,
            options: [.s3DisableChunkedUploads]
        )
    }

    deinit {
        try? awsClient.syncShutdown()
        try? httpClient.syncShutdown()
    }

    static func r2Endpoint(accountId: String) -> String {
        "https://\(accountId.trimmingCharacters(in: .whitespacesAndNewlines)).r2.cloudflarestorage.com"
    }

    static func objectKey(prefix: String, name: String) -> String {
        "\(R2SettingsStore.normalizePrefix(prefix))\(name)"
    }

    static func makeConfigured() throws -> RemoteBackupStore {
        guard R2SettingsStore.isConfigured,
              let secret = KeychainStore.loadR2SecretAccessKey() else {
            throw RemoteBackupStoreError.notConfigured
        }
        return RemoteBackupStore(config: R2Config(
            accountId: R2SettingsStore.accountId,
            bucket: R2SettingsStore.bucket,
            prefix: R2SettingsStore.prefix,
            accessKeyId: R2SettingsStore.accessKeyId,
            secretAccessKey: secret
        ))
    }

    func manifestKey() -> String {
        Self.objectKey(prefix: prefix, name: SyncScopes.manifestFileName)
    }

    func bundleKey() -> String {
        Self.objectKey(prefix: prefix, name: SyncScopes.bundleFileName)
    }

    func readManifest() async throws -> BackupManifest? {
        do {
            let response = try await s3.getObject(.init(bucket: bucket, key: manifestKey()))
            let bytes = try await response.body.collect(upTo: 1_048_576)
            return BackupManifest.load(fromData: Data(bytes.readableBytesView))
        } catch {
            if isNotFound(error) { return nil }
            throw error
        }
    }

    func readBundle() async throws -> Data {
        let response = try await s3.getObject(.init(bucket: bucket, key: bundleKey()))
        let bytes = try await response.body.collect(upTo: 64 * 1024 * 1024)
        return Data(bytes.readableBytesView)
    }

    func writeBundleAndManifest(bundleBytes: Data, manifest: BackupManifest) async throws {
        let manifestData = try JSONEncoder().encode(manifest)
        _ = try await s3.putObject(.init(
            body: AWSHTTPBody(bytes: bundleBytes),
            bucket: bucket,
            contentType: "application/gzip",
            key: bundleKey()
        ))
        _ = try await s3.putObject(.init(
            body: AWSHTTPBody(bytes: manifestData),
            bucket: bucket,
            contentType: "application/json",
            key: manifestKey()
        ))
    }

    func testConnection() async -> (ok: Bool, error: String?) {
        do {
            _ = try await s3.headBucket(.init(bucket: bucket))
            do {
                _ = try await s3.headObject(.init(bucket: bucket, key: manifestKey()))
            } catch {
                if !isNotFound(error) { throw error }
            }
            return (true, nil)
        } catch {
            return (false, error.localizedDescription)
        }
    }

    private func isNotFound(_ error: Error) -> Bool {
        if let awsError = error as? AWSResponseError {
            if awsError.errorCode.lowercased().contains("nosuchkey") { return true }
            if awsError.context?.responseCode == .notFound { return true }
        }
        if let rawError = error as? AWSRawError, rawError.context.responseCode == .notFound {
            return true
        }
        let message = error.localizedDescription.lowercased()
        return message.contains("404") || message.contains("not found") || message.contains("nosuchkey")
    }
}
