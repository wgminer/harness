import Foundation

/// Extracts Apple Voice Memos on-device transcripts embedded in `.m4a` / `.qta` files.
///
/// Voice Memos stores transcripts in a proprietary `tsrp` atom (path: `moov/trak/udta/tsrp`)
/// or, on newer recordings, in metadata keyed by `com.apple.VoiceMemos.tsrp`.
/// There is no public API — this scans the file bytes for the JSON payload Apple embeds.
enum VoiceMemoTranscriptExtractor {
    /// Returns plain transcript text when Apple has already transcribed the recording.
    static func extract(from url: URL) -> String? {
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return nil }

        if let text = extractFromTSRPAtom(data), !text.isEmpty {
            return text
        }
        if let text = extractFromMetadataScan(data), !text.isEmpty {
            return text
        }
        return nil
    }

    /// Scan raw bytes for Apple's attributedString JSON (works for both atom layouts).
    private static func extractFromMetadataScan(_ data: Data) -> String? {
        guard let haystack = String(data: data, encoding: .utf8) else { return nil }
        guard let range = haystack.range(of: "\"attributedString\"") else { return nil }

        let startIndex = range.lowerBound
        guard let openBrace = haystack[..<startIndex].lastIndex(of: "{") else { return nil }

        var depth = 0
        var endIndex = openBrace
        for index in haystack[openBrace...].indices {
            let char = haystack[index]
            if char == "{" { depth += 1 }
            if char == "}" {
                depth -= 1
                if depth == 0 {
                    endIndex = index
                    break
                }
            }
        }

        let jsonSlice = String(haystack[openBrace ... endIndex])
        guard let jsonData = jsonSlice.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let attributed = root["attributedString"] as? [String: Any],
              let runs = attributed["runs"] as? [Any]
        else {
            return nil
        }

        return joinRuns(runs)
    }

    private static func extractFromTSRPAtom(_ data: Data) -> String? {
        guard let marker = "tsrp".data(using: .ascii),
              let range = data.range(of: marker)
        else { return nil }

        let searchStart = range.upperBound
        let tail = data[searchStart ..< min(searchStart + 512_000, data.count)]
        guard let text = String(data: tail, encoding: .utf8),
              text.contains("attributedString")
        else { return nil }

        return extractFromMetadataScan(data)
    }

    private static func joinRuns(_ runs: [Any]) -> String {
        runs.compactMap { element -> String? in
            if let text = element as? String { return text }
            return nil
        }
        .joined()
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
