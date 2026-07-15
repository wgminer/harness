import Foundation

/// Canonical JSON for sync-merge output and cross-platform revision hashes.
///
/// Format: 2-space pretty-print (or compact for dedup stamps), object keys sorted
/// lexicographically at every nesting level, no trailing newline.
///
/// Changing this format changes revision hashes once — devices must re-pull.
enum CanonicalJson {
    static func encodePretty(_ object: Any) -> Data {
        guard JSONSerialization.isValidJSONObject(object),
              var data = try? JSONSerialization.data(
                  withJSONObject: object,
                  options: [.prettyPrinted, .sortedKeys]
              )
        else { return Data() }
        data = normalizePrettyJson(data)
        return data
    }

    static func encodeCompactStamp(_ object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Foundation pretty-print uses `"key" : value`; TS/Rust use `"key": value`.
    private static func normalizePrettyJson(_ data: Data) -> Data {
        guard var text = String(data: data, encoding: .utf8) else { return data }
        text = text.replacingOccurrences(of: "\" : ", with: "\": ")
        if text.hasSuffix("\n") {
            text.removeLast()
        }
        return Data(text.utf8)
    }
}
