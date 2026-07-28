import Foundation

/// Splits streaming markdown into stable completed blocks plus a trailing partial.
/// `completed.joined() + trailing == content` always holds.
struct StreamingMarkdownBlocks: Equatable {
    var completed: [String]
    var trailing: String

    static func split(_ content: String) -> StreamingMarkdownBlocks {
        split(content, previous: nil)
    }

    /// Incremental split: when `content` still begins with `previous.completed.joined()`,
    /// only re-scan the remainder so settled blocks stay identity-stable for MarkdownUI.
    static func split(_ content: String, previous: StreamingMarkdownBlocks?) -> StreamingMarkdownBlocks {
        if let previous, !previous.completed.isEmpty {
            let prefix = previous.completed.joined()
            if content.hasPrefix(prefix) {
                var remainder = String(content.dropFirst(prefix.count))
                var completed = previous.completed

                // Full split attaches blank-line separators to the preceding segment when a
                // new segment starts. Mirror that when growing past a fully-consumed trailing.
                if previous.trailing.isEmpty,
                   let absorbed = absorbLeadingBlankLineSeparators(from: &remainder),
                   !absorbed.isEmpty {
                    completed[completed.count - 1] += absorbed
                }

                let remainderSplit = splitFull(remainder)
                return StreamingMarkdownBlocks(
                    completed: completed + remainderSplit.completed,
                    trailing: remainderSplit.trailing
                )
            }
        }
        return splitFull(content)
    }

    /// If `text` starts with one or more blank lines and then more content, move those
    /// separator lines out of `text` and return them. EOF-only blank lines are left alone.
    private static func absorbLeadingBlankLineSeparators(from text: inout String) -> String? {
        guard !text.isEmpty else { return nil }
        var index = text.startIndex
        var absorbed = ""
        while index < text.endIndex {
            let lineEnd = text[index...].firstIndex(of: "\n").map { text.index(after: $0) } ?? text.endIndex
            let line = String(text[index..<lineEnd])
            let body = line.hasSuffix("\n") ? String(line.dropLast()) : line
            guard isBlankLine(body) else { break }
            absorbed += line
            index = lineEnd
        }
        guard !absorbed.isEmpty, index < text.endIndex else { return nil }
        text = String(text[index...])
        return absorbed
    }

    private static func splitFull(_ content: String) -> StreamingMarkdownBlocks {
        guard !content.isEmpty else {
            return StreamingMarkdownBlocks(completed: [], trailing: "")
        }

        let segments = fenceAwareSegments(in: content)
        guard let last = segments.last else {
            return StreamingMarkdownBlocks(completed: [], trailing: "")
        }

        if segments.count == 1 {
            if isClosedFenceBlock(last) {
                return StreamingMarkdownBlocks(completed: [last], trailing: "")
            }
            return StreamingMarkdownBlocks(completed: [], trailing: last)
        }

        var completed = Array(segments.dropLast())
        var trailing = last

        while let block = completed.last,
              !isClosedFenceBlock(block),
              hasUnbalancedInlineMarkers(block) {
            trailing = block + trailing
            completed.removeLast()
        }

        if isClosedFenceBlock(trailing) {
            completed.append(trailing)
            trailing = ""
        }

        return StreamingMarkdownBlocks(completed: completed, trailing: trailing)
    }

    /// Segments separated by blank lines outside fences. Each separator (`\n\n+`) stays
    /// attached to the preceding segment so joining reconstructs `content`.
    private static func fenceAwareSegments(in content: String) -> [String] {
        var segments: [String] = []
        var current = ""
        var inFence = false
        var lineStart = content.startIndex

        while lineStart < content.endIndex {
            let lineEnd = content[lineStart...].firstIndex(of: "\n").map { content.index(after: $0) }
                ?? content.endIndex
            let line = String(content[lineStart..<lineEnd])
            let lineBody = line.hasSuffix("\n") ? String(line.dropLast()) : line

            if isFenceDelimiter(lineBody) {
                inFence.toggle()
                current += line
                lineStart = lineEnd
                continue
            }

            if !inFence, isBlankLine(lineBody), !current.isEmpty {
                current += line
                lineStart = lineEnd
                while lineStart < content.endIndex {
                    let nextEnd = content[lineStart...].firstIndex(of: "\n").map { content.index(after: $0) }
                        ?? content.endIndex
                    let nextLine = String(content[lineStart..<nextEnd])
                    let nextBody = nextLine.hasSuffix("\n") ? String(nextLine.dropLast()) : nextLine
                    if isBlankLine(nextBody) {
                        current += nextLine
                        lineStart = nextEnd
                        continue
                    }
                    break
                }
                if lineStart < content.endIndex {
                    segments.append(current)
                    current = ""
                }
                continue
            }

            current += line
            lineStart = lineEnd
        }

        segments.append(current)
        return segments
    }

    private static func isFenceDelimiter(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("```") else { return false }
        let afterTicks = trimmed.drop(while: { $0 == "`" })
        return !afterTicks.contains("`")
    }

    private static func isBlankLine(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).isEmpty
    }

    static func isClosedFenceBlock(_ block: String) -> Bool {
        let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let firstNonBlank = lines.first(where: { !isBlankLine($0) }) else {
            return false
        }
        guard isFenceDelimiter(firstNonBlank) else { return false }

        var fenceCount = 0
        for line in lines {
            if isFenceDelimiter(line) {
                fenceCount += 1
            }
        }
        return fenceCount >= 2 && fenceCount % 2 == 0
    }

    /// Unbalanced `**` or inline `` ` `` (ignoring fence delimiter lines) → unsafe for MarkdownUI yet.
    static func hasUnbalancedInlineMarkers(_ text: String) -> Bool {
        if unbalancedMarkerCount(of: "**", in: text) { return true }
        if hasUnbalancedInlineBackticks(text) { return true }
        return false
    }

    private static func unbalancedMarkerCount(of marker: String, in text: String) -> Bool {
        var count = 0
        var search = text.startIndex
        while let range = text.range(of: marker, range: search..<text.endIndex) {
            count += 1
            search = range.upperBound
        }
        return count % 2 != 0
    }

    private static func hasUnbalancedInlineBackticks(_ text: String) -> Bool {
        var inlineTicks = 0
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let body = String(line)
            if isFenceDelimiter(body) { continue }
            for ch in body where ch == "`" {
                inlineTicks += 1
            }
        }
        return inlineTicks % 2 != 0
    }
}
