import Foundation

enum SearchResultKind: String, Codable, Equatable {
    case chat
    case dictation
    case note
    case image
}

struct ConversationSearchResult: Codable, Equatable {
    let id: String
    let kind: SearchResultKind
    let title: String?
    let createdAt: Int64
    let titleMatched: Bool
    let titleMatchRange: [Int]?
    let snippet: String
    let snippetMatchRange: [Int]
    let score: Int64
}

struct MemorySearchHit: Codable, Equatable {
    let kind: SearchResultKind
    let id: String
    let title: String
    let activityAt: Int64
    let score: Int64
    let matchCount: Int?
    let excerpts: [String]?
    let snippet: String?
    let href: String?

    enum LibraryRefTarget: Equatable {
        case conversation
        case note
        case image
    }

    struct LibraryRef: Equatable {
        let target: LibraryRefTarget
        let id: String
    }

    static func array(from toolPayload: [String: Any]?) -> [MemorySearchHit] {
        guard let results = toolPayload?["results"] as? [[String: Any]],
              let data = try? JSONSerialization.data(withJSONObject: results),
              let hits = try? JSONDecoder().decode([MemorySearchHit].self, from: data)
        else { return [] }
        return hits
    }
}

enum ConversationSearch {
    private struct Contract: Decodable {
        let minTokenLength: Int
        let stopwords: [String]
        let weights: Weights
        let toolResultCap: Int
        let excerptBudget: Int
        let excerptCount: Int
        let snippetCharsBefore: Int
        let snippetCharsAfter: Int
        let snippetMaxLines: Int
        let hrefPrefixes: HrefPrefixes

        struct HrefPrefixes: Decodable {
            let chat: String
            let dictation: String
            let note: String
            let image: String
        }

        struct Weights: Decodable {
            let titleToken: Int64
            let bodyToken: Int64
            let messageMatch: Int64
            let allTokensBonus: Int64
        }
    }

    private struct TitleCandidate {
        let id: String
        let title: String
        let activityAt: Int64
    }

    private struct ConversationCandidate {
        let id: String
        let meta: ConversationMeta
        let messages: [MessageRecord]
        let activityAt: Int64
    }

    private static let contract: Contract = loadContract()

    private static func loadContract() -> Contract {
        guard let url = Bundle.main.url(forResource: "conversationSearch", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let parsed = try? JSONDecoder().decode(Contract.self, from: data)
        else {
            fatalError("conversationSearch.json failed to load from the app bundle")
        }
        return parsed
    }

    static func libraryHref(kind: SearchResultKind, id: String) -> String {
        let p = contract.hrefPrefixes
        switch kind {
        case .chat: return p.chat + id
        case .dictation: return p.dictation + id
        case .note: return p.note + id
        case .image: return p.image + id
        }
    }

    static func parseLibraryHref(_ raw: String) -> MemorySearchHit.LibraryRef? {
        var path = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "`"))
        if let url = URL(string: path), url.scheme != nil { path = url.path }
        let p = contract.hrefPrefixes
        let pairs = [(p.note, MemorySearchHit.LibraryRefTarget.note), (p.image, .image), (p.chat, .conversation)]
        for (prefix, target) in pairs where path.hasPrefix(prefix) {
            let id = String(path.dropFirst(prefix.count)).removingPercentEncoding ?? ""
            if id.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$"#, options: .regularExpression) != nil {
                return .init(target: target, id: id)
            }
        }
        if path.range(of: #"^conv_[A-Za-z0-9_]+$"#, options: .regularExpression) != nil {
            return .init(target: .conversation, id: path)
        }
        return nil
    }

    static func tokenizeQuery(_ raw: String) -> [String] {
        let stop = Set(contract.stopwords.map { $0.lowercased() })
        let parts = raw.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
        var seen = Set<String>()
        var out: [String] = []
        for token in parts where !token.isEmpty {
            guard token.count >= contract.minTokenLength, !stop.contains(token) else { continue }
            if seen.insert(token).inserted {
                out.append(token)
            }
        }
        return out
    }

    static func search(in localDataDir: URL, query: String, composeFirstOnly: Bool = true) throws -> [ConversationSearchResult] {
        let candidates = try loadConversationCandidates(localDataDir: localDataDir)
        return searchConversationCandidates(candidates, query: query, excludeId: nil, requireMessages: composeFirstOnly)
    }

    static func searchLibrary(
        in localDataDir: URL,
        query: String,
        excludeConversationId: String? = nil
    ) throws -> [MemorySearchHit] {
        let tokens = tokenizeQuery(query)
        guard !tokens.isEmpty else { return [] }

        let conversations = try loadConversationCandidates(localDataDir: localDataDir)
        let notes = try loadNoteCandidates(localDataDir: localDataDir)
        let images = try loadImageCandidates(localDataDir: localDataDir)

        var hits: [MemorySearchHit] = []

        for candidate in conversations {
            if candidate.id == excludeConversationId { continue }
            if candidate.meta.hasMessages != true, candidate.messages.isEmpty { continue }
            guard let scored = scoreConversation(candidate, tokens: tokens) else { continue }
            let titleRaw = candidate.meta.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let title = titleRaw.isEmpty ? "Untitled chat" : titleRaw
            let kind = conversationKind(candidate.meta)
            hits.append(
                MemorySearchHit(
                    kind: kind,
                    id: candidate.id,
                    title: title,
                    activityAt: candidate.activityAt,
                    score: scored.score,
                    matchCount: scored.matchCount,
                    excerpts: scored.excerpts.isEmpty ? nil : scored.excerpts,
                    snippet: scored.snippet.isEmpty ? nil : scored.snippet,
                    href: libraryHref(kind: kind, id: candidate.id)
                )
            )
        }

        for candidate in notes {
            guard let (score, _) = scoreTitleOnly(candidate.title, tokens: tokens) else { continue }
            hits.append(
                MemorySearchHit(
                    kind: .note,
                    id: candidate.id,
                    title: candidate.title,
                    activityAt: candidate.activityAt,
                    score: score,
                    matchCount: nil,
                    excerpts: nil,
                    snippet: candidate.title,
                    href: libraryHref(kind: .note, id: candidate.id)
                )
            )
        }

        for candidate in images {
            guard let (score, _) = scoreTitleOnly(candidate.title, tokens: tokens) else { continue }
            hits.append(
                MemorySearchHit(
                    kind: .image,
                    id: candidate.id,
                    title: candidate.title,
                    activityAt: candidate.activityAt,
                    score: score,
                    matchCount: nil,
                    excerpts: nil,
                    snippet: candidate.title,
                    href: libraryHref(kind: .image, id: candidate.id)
                )
            )
        }

        hits.sort {
            if $0.score != $1.score { return $0.score > $1.score }
            return $0.activityAt > $1.activityAt
        }
        if hits.count > contract.toolResultCap {
            hits = Array(hits.prefix(contract.toolResultCap))
        }
        return hits
    }

    static func extractSnippet(content: String, matchIndex: Int, matchLen: Int) -> (snippet: String, snippetMatchRange: [Int]) {
        let cfg = contract
        let windowStart = max(0, matchIndex - cfg.snippetCharsBefore)
        let matchEndInContent = matchIndex + matchLen
        var snippetEnd = min(content.count, matchEndInContent + cfg.snippetCharsAfter)
        var snippetStart = windowStart

        if let lastNewlineBefore = content[..<content.index(content.startIndex, offsetBy: min(matchIndex, content.count))]
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
            if nextIndex <= snippetEnd {
                snippetEnd = nextIndex + 1
            }
        }

        var lineCount = 1
        var index = snippetStart
        while index < snippetEnd, lineCount < cfg.snippetMaxLines {
            let charIndex = content.index(content.startIndex, offsetBy: index)
            if content[charIndex] == "\n" { lineCount += 1 }
            index += 1
        }

        if lineCount >= cfg.snippetMaxLines {
            let startIndex = content.index(content.startIndex, offsetBy: snippetStart)
            if let firstNewline = content[startIndex...].firstIndex(of: "\n"),
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
        let matchEndInSnippet = matchStartInSnippet + matchLen
        let clampedStart = max(0, min(matchStartInSnippet, snippet.count))
        let clampedEnd = max(clampedStart, min(matchEndInSnippet, snippet.count))
        return (snippet, [clampedStart, clampedEnd])
    }

    // MARK: - Private

    private struct ConversationScore {
        let score: Int64
        let titleMatched: Bool
        let titleMatchRange: [Int]?
        let snippet: String
        let snippetMatchRange: [Int]
        let matchCount: Int
        let excerpts: [String]
    }

    private static func searchConversationCandidates(
        _ candidates: [ConversationCandidate],
        query: String,
        excludeId: String?,
        requireMessages: Bool
    ) -> [ConversationSearchResult] {
        let tokens = tokenizeQuery(query)
        guard !tokens.isEmpty else { return [] }

        var results: [ConversationSearchResult] = []
        for candidate in candidates {
            if candidate.id == excludeId { continue }
            if requireMessages, candidate.meta.hasMessages != true, candidate.messages.isEmpty { continue }
            guard let scored = scoreConversation(candidate, tokens: tokens) else { continue }
            results.append(
                ConversationSearchResult(
                    id: candidate.id,
                    kind: conversationKind(candidate.meta),
                    title: candidate.meta.title,
                    createdAt: candidate.meta.createdAt,
                    titleMatched: scored.titleMatched,
                    titleMatchRange: scored.titleMatchRange,
                    snippet: scored.snippet,
                    snippetMatchRange: scored.snippetMatchRange,
                    score: scored.score
                )
            )
        }

        results.sort {
            if $0.score != $1.score { return $0.score > $1.score }
            return $0.createdAt > $1.createdAt
        }
        return results
    }

    private static func loadConversationCandidates(localDataDir: URL) throws -> [ConversationCandidate] {
        let conversationsPath = LocalDataLayout.fileURL(
            in: localDataDir,
            relativePath: LocalDataLayout.conversationsFile
        )
        guard FileManager.default.fileExists(atPath: conversationsPath.path) else { return [] }
        let data = try LocalDataLayout.readRegularFileData(at: conversationsPath)
        guard !data.isEmpty else { return [] }
        let map = try JSONDecoder().decode([String: ConversationMeta].self, from: data)

        var out: [ConversationCandidate] = []
        for (id, meta) in map {
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
            let activityAt = conversationActivityAt(messages: messages, createdAt: meta.createdAt)
            out.append(ConversationCandidate(id: id, meta: meta, messages: messages, activityAt: activityAt))
        }
        return out
    }

    private static func loadNoteCandidates(localDataDir: URL) throws -> [TitleCandidate] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.notesIndexFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return [] }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = json["notes"] as? [[String: Any]]
        else { return [] }

        return rows.compactMap { row in
            guard let id = row["id"] as? String,
                  let title = row["title"] as? String
            else { return nil }
            let activityAt = (row["updatedAt"] as? Int64) ?? (row["updatedAt"] as? NSNumber)?.int64Value
                ?? (row["createdAt"] as? Int64) ?? (row["createdAt"] as? NSNumber)?.int64Value ?? 0
            return TitleCandidate(id: id, title: title, activityAt: activityAt)
        }
    }

    private static func loadImageCandidates(localDataDir: URL) throws -> [TitleCandidate] {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.imagesIndexFile)
        guard FileManager.default.fileExists(atPath: path.path) else { return [] }
        let data = try LocalDataLayout.readRegularFileData(at: path)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = json["images"] as? [[String: Any]]
        else { return [] }

        return rows.compactMap { row in
            guard let id = row["id"] as? String,
                  let title = row["title"] as? String
            else { return nil }
            let activityAt = (row["updatedAt"] as? Int64) ?? (row["updatedAt"] as? NSNumber)?.int64Value
                ?? (row["createdAt"] as? Int64) ?? (row["createdAt"] as? NSNumber)?.int64Value ?? 0
            return TitleCandidate(id: id, title: title, activityAt: activityAt)
        }
    }

    private static func conversationActivityAt(messages: [MessageRecord], createdAt: Int64) -> Int64 {
        messages.compactMap(\.timestamp).max() ?? createdAt
    }

    private static func isDictation(_ meta: ConversationMeta) -> Bool {
        if meta.sessionKind == "dictation" { return true }
        if let title = meta.title?.trimmingCharacters(in: .whitespacesAndNewlines),
           title.hasPrefix("Dictation @ "),
           meta.hasAssistantReply != true
        {
            return true
        }
        return false
    }

    private static func conversationKind(_ meta: ConversationMeta) -> SearchResultKind {
        isDictation(meta) ? .dictation : .chat
    }

    private static func stripSentAtPrefix(_ content: String) -> String {
        content.replacingOccurrences(
            of: #"^\[sent_at=[^\]]+\]\n?"#,
            with: "",
            options: .regularExpression
        )
    }

    private static func findFirstTokenMatch(_ text: String, tokens: [String]) -> (index: Int, length: Int)? {
        let lower = text.lowercased()
        for token in tokens {
            if let range = lower.range(of: token) {
                return (lower.distance(from: lower.startIndex, to: range.lowerBound), token.count)
            }
        }
        return nil
    }

    private static func scoreTokensInText(_ text: String, tokens: [String], perToken: Int64) -> Int64 {
        guard !tokens.isEmpty, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return 0 }
        let lower = text.lowercased()
        var score: Int64 = 0
        var matched = 0
        for token in tokens where lower.contains(token) {
            score += perToken
            matched += 1
        }
        if matched == tokens.count, tokens.count > 1 {
            score += contract.weights.allTokensBonus
        }
        return score
    }

    private static func scoreTitleOnly(_ title: String, tokens: [String]) -> (Int64, [Int]?)? {
        let score = scoreTokensInText(title, tokens: tokens, perToken: contract.weights.titleToken)
        guard score > 0 else { return nil }
        let range = findFirstTokenMatch(title, tokens: tokens).map { [$0.index, $0.index + $0.length] }
        return (score, range)
    }

    private static func scoreConversation(_ candidate: ConversationCandidate, tokens: [String]) -> ConversationScore? {
        guard !tokens.isEmpty else { return nil }
        let titleStr = candidate.meta.title ?? ""
        var score = scoreTokensInText(titleStr, tokens: tokens, perToken: contract.weights.titleToken)
        let titleMatched = tokens.contains { titleStr.lowercased().contains($0) }
        let titleMatchRange = titleMatched ? findFirstTokenMatch(titleStr, tokens: tokens).map { [$0.index, $0.index + $0.length] } : nil

        var matchCount = 0
        var excerptSources: [String] = []
        var bestSnippet = ""
        var bestSnippetRange = [-1, -1]

        for message in candidate.messages {
            let stripped = stripSentAtPrefix(message.content.trimmingCharacters(in: .whitespacesAndNewlines))
            guard !stripped.isEmpty else { continue }
            let bodyScore = scoreTokensInText(stripped, tokens: tokens, perToken: contract.weights.bodyToken)
            if bodyScore > 0 {
                matchCount += 1
                score += bodyScore + contract.weights.messageMatch
                excerptSources.append(stripped)
                if bestSnippetRange[0] < 0, let hit = findFirstTokenMatch(stripped, tokens: tokens) {
                    let extracted = extractSnippet(content: stripped, matchIndex: hit.index, matchLen: hit.length)
                    bestSnippet = extracted.snippet
                    bestSnippetRange = extracted.snippetMatchRange
                }
            }
        }

        guard score > 0 else { return nil }

        if bestSnippet.isEmpty, titleMatched {
            let first = candidate.messages.first(where: { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })?.content ?? ""
            let lines = first.split(separator: "\n", omittingEmptySubsequences: false).prefix(contract.snippetMaxLines)
            bestSnippet = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if bestSnippet.isEmpty { bestSnippet = "No message content" }
            bestSnippetRange = [-1, -1]
        } else if bestSnippet.isEmpty {
            bestSnippet = String(excerptSources.first?.prefix(contract.excerptBudget) ?? "")
            bestSnippetRange = [-1, -1]
        }

        var excerpts: [String] = []
        for source in excerptSources.prefix(contract.excerptCount) {
            if let hit = findFirstTokenMatch(source, tokens: tokens) {
                excerpts.append(extractSnippet(content: source, matchIndex: hit.index, matchLen: hit.length).snippet)
            } else {
                excerpts.append(String(source.prefix(contract.excerptBudget)))
            }
        }

        return ConversationScore(
            score: score,
            titleMatched: titleMatched,
            titleMatchRange: titleMatchRange,
            snippet: bestSnippet,
            snippetMatchRange: bestSnippetRange,
            matchCount: matchCount,
            excerpts: excerpts
        )
    }
}
