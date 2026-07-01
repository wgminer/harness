import Foundation
import Security

enum KeychainStore {
    private static let service = "com.harness.mobile"
    private static let openAIAccount = "openai-api-key"
    private static let r2SecretAccount = "r2-secret-access-key"
    private static let importedSettingsKeyFlag = HarnessStorageKeys.importedOpenAIKeyFromSync

    static var hasImportedOpenAIKeyFromSync: Bool {
        get { UserDefaults.standard.bool(forKey: importedSettingsKeyFlag) }
        set { UserDefaults.standard.set(newValue, forKey: importedSettingsKeyFlag) }
    }

    static func loadAPIKey() -> String? {
        loadGeneric(account: openAIAccount)
    }

    static func saveAPIKey(_ key: String) throws {
        try saveGeneric(account: openAIAccount, value: key)
    }

    static func deleteAPIKey() {
        deleteGeneric(account: openAIAccount)
    }

    static func loadR2SecretAccessKey() -> String? {
        loadGeneric(account: r2SecretAccount)
    }

    static func saveR2SecretAccessKey(_ key: String) throws {
        try saveGeneric(account: r2SecretAccount, value: key)
    }

    static func deleteR2SecretAccessKey() {
        deleteGeneric(account: r2SecretAccount)
    }

    private static func loadGeneric(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func saveGeneric(account: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attrs: [String: Any] = [kSecValueData as String: data]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess {
            let update = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
            guard update == errSecSuccess else { throw KeychainError.saveFailed }
        } else {
            var add = query
            add[kSecValueData as String] = data
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.saveFailed }
        }
    }

    private static func deleteGeneric(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: LocalizedError {
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .saveFailed: return "Could not save secret to Keychain."
        }
    }
}
