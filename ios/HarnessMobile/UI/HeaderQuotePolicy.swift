import Foundation

struct HomeHeaderQuote: Equatable {
    let id: String
    let short: String
    let full: String
    let author: String
    let source: String
    let job: String
    let context: String
    let moral: String
}

/// Quote shown at the top of the conversation list / compose screen.
/// Home quotes come from bundled `resources/contracts/homeHeaderQuotes.json`
/// (same file TypeScript imports).
enum HeaderQuotePolicy {
    static let homeHeaderQuoteBagKey = "harness.homeHeaderQuoteBag"
    private static let fallbackShort = "Begin"

    static var homeHeaderQuotes: [HomeHeaderQuote] { Self.loadHomeHeaderQuotes() }

    /// Short lines only (legacy helpers / tests that want the display strings).
    static var homeHeaderQuoteShorts: [String] {
        homeHeaderQuotes.map(\.short)
    }

    /// Next compose quote from the per-device shuffle bag (matches desktop `nextHomeHeaderQuote`).
    static var homeHeaderQuote: String {
        nextHomeHeaderQuote().short
    }

    static let clippingsNoteTitle = "Clippings"

    /// Draw the next quote; persists remaining ids in UserDefaults (not synced).
    static func nextHomeHeaderQuote(
        defaults: UserDefaults = .standard,
        random: (Int) -> Int = { Int.random(in: 0..<$0) }
    ) -> HomeHeaderQuote {
        let quotes = homeHeaderQuotes
        guard !quotes.isEmpty else {
            return HomeHeaderQuote(
                id: "fallback",
                short: fallbackShort,
                full: fallbackShort,
                author: "",
                source: "",
                job: "center",
                context: "",
                moral: ""
            )
        }

        var remaining = loadRemainingIds(defaults: defaults, knownIds: Set(quotes.map(\.id)))
        if remaining.isEmpty {
            remaining = shuffleIds(quotes.map(\.id), random: random)
        }

        let id = remaining.removeFirst()
        saveRemainingIds(remaining, defaults: defaults)

        return quotes.first(where: { $0.id == id }) ?? quotes[0]
    }

    static func headerQuote(fromNoteContent content: String, rotationIndex: Int = 0) -> String {
        let pool = numberedListItems(from: content)
            .map { formatForHeader(stripInlineTags($0)) }
            .filter { !$0.isEmpty }
        guard !pool.isEmpty else { return "" }
        let index = ((rotationIndex % pool.count) + pool.count) % pool.count
        return pool[index]
    }

    static func numberedListItems(from content: String) -> [String] {
        content.split(separator: "\n", omittingEmptySubsequences: false).compactMap { line in
            let trimmed = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let match = trimmed.range(of: #"^\d+\.\s+"#, options: .regularExpression) else { return nil }
            return String(trimmed[match.upperBound...])
        }
    }

    static func loadClippingsNoteContent(in localDataDir: URL) -> String {
        let indexURL = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.notesIndexFile)
        guard let data = try? LocalDataLayout.readRegularFileData(at: indexURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let notes = object["notes"] as? [[String: Any]]
        else { return "" }

        guard let entry = notes.first(where: {
            (($0["title"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()) == clippingsNoteTitle.lowercased()
        }), let id = entry["id"] as? String else { return "" }

        let noteURL = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.noteFile(id: id)
        )
        guard let noteData = try? Data(contentsOf: noteURL) else { return "" }
        return String(data: noteData, encoding: .utf8) ?? ""
    }

    static func stripInlineTags(_ text: String) -> String {
        text.replacingOccurrences(
            of: #"\s+#\S+"#,
            with: "",
            options: .regularExpression
        )
    }

    static func formatForHeader(_ text: String) -> String {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        trimmed = trimmed.replacingOccurrences(
            of: #"\s+"#,
            with: " ",
            options: .regularExpression
        )
        return trimmed
    }

    /// Fisher–Yates using `random(upperBound)` → index in `0..<upperBound`.
    static func shuffleIds(_ ids: [String], random: (Int) -> Int) -> [String] {
        var next = ids
        guard next.count > 1 else { return next }
        for i in stride(from: next.count - 1, through: 1, by: -1) {
            let j = random(i + 1)
            guard j >= 0, j <= i else { continue }
            next.swapAt(i, j)
        }
        return next
    }

    private static func loadRemainingIds(defaults: UserDefaults, knownIds: Set<String>) -> [String] {
        guard let raw = defaults.array(forKey: homeHeaderQuoteBagKey) as? [String] else { return [] }
        return raw.filter { knownIds.contains($0) }
    }

    private static func saveRemainingIds(_ remaining: [String], defaults: UserDefaults) {
        defaults.set(remaining, forKey: homeHeaderQuoteBagKey)
    }

    private static func loadHomeHeaderQuotes() -> [HomeHeaderQuote] {
        guard let url = Bundle.main.url(forResource: "homeHeaderQuotes", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let quotes = json["quotes"] as? [[String: Any]]
        else {
            assertionFailure("resources/contracts/homeHeaderQuotes.json failed to load or parse from the app bundle")
            return []
        }

        let cleaned: [HomeHeaderQuote] = quotes.compactMap { entry in
            guard let id = (entry["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let short = (entry["short"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let full = (entry["full"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let author = (entry["author"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let source = (entry["source"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let job = (entry["job"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let context = (entry["context"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let moral = (entry["moral"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !id.isEmpty,
                  !short.isEmpty,
                  !full.isEmpty,
                  !context.isEmpty,
                  !moral.isEmpty
            else { return nil }
            return HomeHeaderQuote(
                id: id,
                short: short,
                full: full,
                author: author,
                source: source,
                job: job,
                context: context,
                moral: moral
            )
        }
        return cleaned
    }
}
