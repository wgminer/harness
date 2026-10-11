import Foundation

/// Cleans assistant markdown for display: hides desktop Grill choice fences (`::::options`)
/// and flattens retired layout directives (`:::tip`, `:::details`, `:chip[...]`, `:::link`).
/// Mirrors `src/shared/qaOptions.ts` (`stripQaOptions`) and `src/shared/layoutDirectives.ts`.
enum ChatDisplayText {
    static func forDisplay(_ markdown: String) -> String {
        stripLayoutDirectives(stripQaOptions(markdown))
    }

    // MARK: - Grill choice fences

    static func stripQaOptions(_ markdown: String) -> String {
        guard markdown.contains(":::") else { return markdown }
        var out = markdown
        out = replace(out, #"::::\s*options\b[^\n]*\n([\s\S]*?)\n::::\s*(?:\n|$)"#, with: "", options: [.caseInsensitive])
        out = replace(out, #":::option\{[^}]*\}[\s\S]*?(?:\n:::\s*)?"#, with: "", options: [.caseInsensitive])
        out = replace(out, #"^::::\s*options\b.*$"#, with: "", options: [.caseInsensitive, .anchorsMatchLines])
        out = replace(out, #"^::::\s*$"#, with: "", options: [.anchorsMatchLines])
        out = replace(out, #"^:::\s*$"#, with: "", options: [.anchorsMatchLines])
        out = replace(out, #"\n{3,}"#, with: "\n\n")
        while let last = out.last, last.isWhitespace { out.removeLast() }
        return out
    }

    // MARK: - Retired layout directives

    static func stripLayoutDirectives(_ markdown: String) -> String {
        guard markdown.contains(":::") || markdown.contains(":chip[") else { return markdown }
        var out: [String] = []
        var inCode = false
        var changed = false
        // A removed fence line leaves one blank line so the block stays its own paragraph.
        func pushBreak() {
            changed = true
            if let last = out.last, !last.isEmpty { out.append("") }
        }
        for line in markdown.components(separatedBy: "\n") {
            if firstMatch(line, #"^\s*(```|~~~)"#) != nil {
                inCode.toggle()
                out.append(line)
                continue
            }
            if inCode {
                out.append(line)
                continue
            }
            if let open = firstMatch(
                line,
                #"^:{3,}\s*(tip|note|warning|danger|details|link)\b\s*(\{.*\})?\s*$"#,
                options: [.caseInsensitive]
            ) {
                let name = (open[1] ?? "").lowercased()
                let attrs = open[2] ?? ""
                pushBreak()
                if name == "link" {
                    let url = attribute(attrs, "url")
                    if !url.isEmpty {
                        let title = attribute(attrs, "title")
                        let desc = attribute(attrs, "desc")
                        out.append("[\(title.isEmpty ? url : title)](\(url))" + (desc.isEmpty ? "" : " — \(desc)"))
                    }
                } else if name == "details" {
                    let summary = attribute(attrs, "summary")
                    if !summary.isEmpty {
                        out.append("**\(summary)**")
                        out.append("")
                    }
                }
                continue
            }
            if firstMatch(line, #"^:{3,}\s*$"#) != nil {
                pushBreak()
                continue
            }
            let replaced = replace(line, #":chip\[([^\]]*)\](?:\{[^}]*\})?"#, with: "$1")
            if replaced != line { changed = true }
            out.append(replaced)
        }
        guard changed else { return markdown }
        while let last = out.last, last.isEmpty { out.removeLast() }
        return out.joined(separator: "\n")
    }

    // MARK: - Regex helpers

    private static func attribute(_ attrs: String, _ name: String) -> String {
        let match = firstMatch(attrs, "\\b\(name)\\s*=\\s*\"([^\"]*)\"", options: [.caseInsensitive])
        return (match?[1] ?? "").trimmingCharacters(in: .whitespaces)
    }

    private static func replace(
        _ text: String,
        _ pattern: String,
        with template: String,
        options: NSRegularExpression.Options = []
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }

    /// Capture groups of the first match (index 0 is the whole match), or nil when there is none.
    private static func firstMatch(
        _ text: String,
        _ pattern: String,
        options: NSRegularExpression.Options = []
    ) -> [String?]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }
        return (0..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: text).map { String(text[$0]) }
        }
    }
}
