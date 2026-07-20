import SwiftUI

/// Renders streaming assistant markdown as stable completed blocks plus a cheap trailing partial.
struct StreamingMarkdownView: View, Equatable {
    let content: String

    static func == (lhs: StreamingMarkdownView, rhs: StreamingMarkdownView) -> Bool {
        lhs.content == rhs.content
    }

    var body: some View {
        let blocks = StreamingMarkdownBlocks.split(content)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.completed.enumerated()), id: \.offset) { _, block in
                StableStreamingMarkdownBlock(content: block)
                    .equatable()
            }
            if !blocks.trailing.isEmpty {
                Text(blocks.trailing)
                    .font(.body)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .animation(nil, value: blocks.trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Isolated equatable wrapper so completed blocks do not re-parse when only trailing grows.
private struct StableStreamingMarkdownBlock: View, Equatable {
    let content: String

    var body: some View {
        HarnessMarkdownView(content: content, isStreaming: false)
            .lineSpacing(4)
            .animation(nil, value: content)
    }
}
