import Foundation

/// Short-lived Mac→phone sync pairing payload (`harness-pair` v1).
/// Keep encoding identical to `src/shared/pairingPayload.ts`.
enum PairingPayload {
    static let prefix = "harness-pair:1:"
    static let ttlSeconds: TimeInterval = 10 * 60

    struct V1: Equatable {
        var exp: TimeInterval
        var accountId: String
        var bucket: String
        var prefix: String
        var accessKeyId: String
        var secretAccessKey: String
        /// May be empty if Mac has no OpenAI key yet.
        var openaiApiKey: String
    }

    enum DecodeError: Error, Equatable {
        case badPrefix
        case badEncoding
        case badJSON
        case badVersion
        case missingFields(String)
        case expired
    }

    static func encode(
        accountId: String,
        bucket: String,
        prefix: String,
        accessKeyId: String,
        secretAccessKey: String,
        openaiApiKey: String,
        now: Date = Date(),
        exp: TimeInterval? = nil
    ) throws -> String {
        let account = try requireNonEmpty(accountId, "accountId")
        let bucketName = try requireNonEmpty(bucket, "bucket")
        let access = try requireNonEmpty(accessKeyId, "accessKeyId")
        let secret = try requireNonEmpty(secretAccessKey, "secretAccessKey")
        let pref = prefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "harness/"
            : prefix.trimmingCharacters(in: .whitespacesAndNewlines)
        let expiry = exp ?? (now.timeIntervalSince1970 + ttlSeconds)
        let object: [String: Any] = [
            "v": 1,
            "exp": Int(expiry.rounded(.down)),
            "accountId": account,
            "bucket": bucketName,
            "prefix": pref,
            "accessKeyId": access,
            "secretAccessKey": secret,
            "openaiApiKey": openaiApiKey.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        let data = try JSONSerialization.data(withJSONObject: object, options: [])
        return Self.prefix + data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .trimmingCharacters(in: CharacterSet(charactersIn: "="))
    }

    static func decode(_ raw: String, now: Date = Date()) throws -> V1 {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix(Self.prefix) else { throw DecodeError.badPrefix }
        let b64url = String(trimmed.dropFirst(Self.prefix.count))
        guard let data = Data(base64URLEncoded: b64url) else { throw DecodeError.badEncoding }
        let json: Any
        do {
            json = try JSONSerialization.jsonObject(with: data, options: [])
        } catch {
            throw DecodeError.badJSON
        }
        guard let obj = json as? [String: Any] else { throw DecodeError.badJSON }
        guard let version = obj["v"] as? Int, version == 1 else { throw DecodeError.badVersion }
        let expValue: TimeInterval
        if let n = obj["exp"] as? NSNumber {
            expValue = n.doubleValue
        } else {
            throw DecodeError.missingFields("exp")
        }
        if expValue < now.timeIntervalSince1970 {
            throw DecodeError.expired
        }
        return V1(
            exp: expValue,
            accountId: try requireNonEmpty(obj["accountId"] as? String, "accountId"),
            bucket: try requireNonEmpty(obj["bucket"] as? String, "bucket"),
            prefix: {
                let p = (obj["prefix"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return p.isEmpty ? "harness/" : p
            }(),
            accessKeyId: try requireNonEmpty(obj["accessKeyId"] as? String, "accessKeyId"),
            secretAccessKey: try requireNonEmpty(obj["secretAccessKey"] as? String, "secretAccessKey"),
            openaiApiKey: ((obj["openaiApiKey"] as? String) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private static func requireNonEmpty(_ value: String?, _ field: String) throws -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw DecodeError.missingFields(field) }
        return trimmed
    }

    private static func requireNonEmpty(_ value: String, _ field: String) throws -> String {
        try requireNonEmpty(Optional(value), field)
    }
}

private extension Data {
    init?(base64URLEncoded string: String) {
        var s = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = (4 - (s.count % 4)) % 4
        if pad > 0 { s += String(repeating: "=", count: pad) }
        self.init(base64Encoded: s)
    }
}
