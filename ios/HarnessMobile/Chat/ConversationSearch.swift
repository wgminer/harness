import Foundation

struct ConversationSearchResult: Codable, Equatable {
    let id: String
    let title: String?
    let createdAt: Int64
    let titleMatched: Bool
    let titleMatchRange: [Int]?
    let snippet: String
    let snippetMatchRange: [Int]
}

enum ConversationSearch {
    private static let snippetCharsBefore = 80
    private static let snippetCharsAfter = 120
    private static let snippetMaxLines = 3

    static func extractSnippet(
        content: String,
        queryLower: String,
        matchIndex: Int
    ) -> (snippet: String, snippetMatchRange: [Int]) {
        let windowStart = max(0, matchIndex - snippetCharsBefore)
        let matchEndInContent = matchIndex + queryLower.count
        let windowEnd = min(content.count, matchEndInContent + snippetCharsAfter)
        var snippetStart = windowStart
        var snippetEnd = windowEnd

        if let lastNewlineBefore = content[..<content.index(content.startIndex, offsetBy: matchIndex)]
            .lastIndex(of: "\n"),
            content.distance(from: content.startIndex, to: lastNewlineBefore) >= windowStart
        {
            snippetStart = content.distance(from: content.startIndex, to: lastNewlineBefore) + 1
        }

        if matchEndInContent < content.count,
           let nextNewlineAfter = content[content.index(content.startIndex, offsetBy: matchEndInContent)...]
            .firstIndex(of: "\n")
        {
            let nextIndex = content.distance(from: content.startIndex, to: nextNewlineAfter)
            if nextIndex <= windowEnd {
                snippetEnd = nextIndex + 1
            }
        }

        var lineCount = 1
        var index = snippetStart
        while index < snippetEnd, lineCount < snippetMaxLines {
            let charIndex = content.index(content.startIndex, offsetBy: index)
            if content[charIndex] == "\n" { lineCount += 1 }
            index += 1
        }

        if lineCount >= snippetMaxLines {
            let startIndex = content.index(content.startIndex, offsetBy: snippetStart)
            let firstNewline = content[startIndex...].firstIndex(of: "\n")
            if let firstNewline,
               let secondNewline = content[content.index(after: firstNewline)...].firstIndex(of: "\n")
            {
                let secondEnd = content.distance(from: content.startIndex, to: secondNewline) + 1
                if secondEnd < snippetEnd {
                    snippetEnd = secondEnd
                }
            }
        }

        let snippetStartIndex = content.index(content.startIndex, offsetBy: snippetStart)
        let snippetEndIndex = content.index(content.startIndex, offsetBy: snippetEnd)
        let snippet = String(content[snippetStartIndex..<snippetEndIndex])
        let matchStartInSnippet = matchIndex - snippetStart
        let matchEndInSnippet = matchStartInSnippet + queryLower.count
        let clampedStart = max(0, min(matchStartInSnippet, snippet.count))
        let clampedEnd = max(clampedStart, min(matchEndInSnippet, snippet.count))
        return (snippet, [clampedStart, clampedEnd])
    }

    static func search(in localDataDir: URL, query: String) throws -> [ConversationSearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let q = trimmed.lowercased()
        guard !q.isEmpty else { return [] }

        let conversationsPath = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.conversationsFile
        )
        guard FileManager.default.fileExists(atPath: conversationsPath.path) else { return [] }

        let data = try LocalDataLayout.readRegularFileData(at: conversationsPath)
        guard !data.isEmpty else { return [] }

        let map = try JSONDecoder().decode([String: ConversationMeta].self, from: data)
        var results: [ConversationSearchResult] = []

        for (id, meta) in map {
            let titleStr = meta.title ?? ""
            let titleLower = titleStr.lowercased()
            let titleMatched = titleLower.contains(q)
            var titleMatchRange: [Int]?
            if titleMatched, let range = titleLower.range(of: q) {
                let start = titleLower.distance(from: titleLower.startIndex, to: range.lowerBound)
                titleMatchRange = [start, start + q.count]
            }

            let messagesPath = LocalDataLayout.fileURL(
                in: localDataDir,
                relativePath: LocalDataLayout.messagesPath(conversationId: id)
            )
            let messages: [MessageRecord]
            if FileManager.default.fileExists(atPath: messagesPath.path) {
                let messagesData = try LocalDataLayout.readRegularFileData(at: messagesPath)
                messages = try JSONDecoder().decode([MessageRecord].self, from: messagesData)
            } else {
                messages = []
            }

            var snippet = ""
            var snippetMatchRange = [-1, -1]
            var contentMatched = false

            for message in messages {
                let lower = message.content.lowercased()
                guard let range = lower.range(of: q) else { continue }
                contentMatched = true
                let matchIndex = lower.distance(from: lower.startIndex, to: range.lowerBound)
                let extracted = extractSnippet(content: message.content, queryLower: q, matchIndex: matchIndex)
                snippet = extracted.snippet
                snippetMatchRange = extracted.snippetMatchRange
                break
            }

            guard titleMatched || contentMatched else { continue }

            if !contentMatched {
                let first = messages.first?.content ?? ""
                let lines = first.split(separator: "\n", omittingEmptySubsequences: false).prefix(snippetMaxLines)
                snippet = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                if snippet.isEmpty {
                    snippet = "No message content"
                }
                snippetMatchRange = [-1, -1]
            }

            results.append(
                ConversationSearchResult(
                    id: id,
                    title: titleStr.isEmpty ? nil : titleStr,
                    createdAt: meta.createdAt,
                    titleMatched: titleMatched,
                    titleMatchRange: titleMatchRange,
                    snippet: snippet,
                    snippetMatchRange: snippetMatchRange
                )
            )
        }

        return results.sorted { $0.createdAt > $1.createdAt }
    }
}
