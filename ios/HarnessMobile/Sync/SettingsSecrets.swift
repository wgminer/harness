import Foundation

enum SettingsSecrets {
    static func stripSettingsSecrets(_ raw: [String: Any]) -> [String: Any] {
        var out = raw
        if var openai = out["openai"] as? [String: Any] {
            openai.removeValue(forKey: "apiKey")
            if openai.isEmpty {
                out.removeValue(forKey: "openai")
            } else {
                out["openai"] = openai
            }
        }
        if var search = out["search"] as? [String: Any] {
            search.removeValue(forKey: "tavilyApiKey")
            if search.isEmpty {
                out.removeValue(forKey: "search")
            } else {
                out["search"] = search
            }
        }
        return out
    }

    static func redactSettingsJsonBytes(_ bytes: Data) -> Data {
        guard let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            return bytes
        }
        let redacted = stripSettingsSecrets(parsed)
        guard JSONSerialization.isValidJSONObject(redacted),
              let data = try? JSONSerialization.data(withJSONObject: redacted, options: [.prettyPrinted, .sortedKeys]) else {
            return bytes
        }
        return data
    }
}
