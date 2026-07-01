import Foundation

enum R2SettingsStore {
    private static let accountIdKey = HarnessStorageKeys.r2AccountId
    private static let bucketKey = HarnessStorageKeys.r2Bucket
    private static let prefixKey = HarnessStorageKeys.r2Prefix
    private static let accessKeyIdKey = HarnessStorageKeys.r2AccessKeyId

    static var accountId: String {
        get { UserDefaults.standard.string(forKey: accountIdKey) ?? "" }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: accountIdKey) }
    }

    static var bucket: String {
        get { UserDefaults.standard.string(forKey: bucketKey) ?? "" }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: bucketKey) }
    }

    static var prefix: String {
        get {
            let raw = UserDefaults.standard.string(forKey: prefixKey) ?? "harness/"
            return normalizePrefix(raw)
        }
        set { UserDefaults.standard.set(normalizePrefix(newValue), forKey: prefixKey) }
    }

    static var accessKeyId: String {
        get { UserDefaults.standard.string(forKey: accessKeyIdKey) ?? "" }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: accessKeyIdKey) }
    }

    static var isConfigured: Bool {
        !accountId.isEmpty && !bucket.isEmpty && !accessKeyId.isEmpty && KeychainStore.loadR2SecretAccessKey() != nil
    }

    static func normalizePrefix(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if trimmed.isEmpty { return "harness/" }
        return trimmed + "/"
    }
}
