import Foundation

/// Quote shown at the top of the conversation list.
enum HeaderQuotePolicy {
    static let homeHeaderQuote = "You are here"

    static let clippingsNoteTitle = "Clippings"

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
}
