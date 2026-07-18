import SwiftUI
import UIKit

struct MessageRowView: View, Equatable {
    let message: MessageRecord
    var localDataDir: URL?
    var isStreaming = false
    var onToolConfirm: ((ToolCallRecord, GatedToolAction) -> Void)?
    @State private var isExpanded = false
    @State private var attachmentImages: [UIImage] = []

    static func == (lhs: MessageRowView, rhs: MessageRowView) -> Bool {
        lhs.message == rhs.message
            && lhs.isStreaming == rhs.isStreaming
            && lhs.localDataDir == rhs.localDataDir
    }

    var body: some View {
        Group {
            switch message.messageRole {
            case .assistant:
                AssistantMessageView(
                    content: ChatTemporalContext.stripSentAtPrefix(message.content),
                    isStreaming: isStreaming,
                    toolCalls: message.toolCalls ?? [],
                    onToolConfirm: onToolConfirm
                )
            case .user:
                UserMessageCard(
                    content: message.content,
                    attachmentImages: attachmentImages,
                    isExpanded: $isExpanded
                )
            case .system:
                AssistantMessageView(
                    content: message.content,
                    isStreaming: isStreaming,
                    toolCalls: message.toolCalls ?? [],
                    onToolConfirm: onToolConfirm
                )
            }
        }
        .task(id: attachmentCacheKey) {
            attachmentImages = await Self.loadAttachmentImages(
                message: message,
                localDataDir: localDataDir
            )
        }
    }

    private var attachmentCacheKey: String {
        guard let attachments = message.attachments, !attachments.isEmpty else { return message.id }
        let paths = attachments.map(\.relativePath).joined(separator: "|")
        return "\(message.id):\(paths)"
    }

    private static func loadAttachmentImages(message: MessageRecord, localDataDir: URL?) async -> [UIImage] {
        guard let localDataDir, let attachments = message.attachments, !attachments.isEmpty else {
            return []
        }
        let paths = attachments.compactMap { attachment -> String? in
            guard attachment.mimeType.hasPrefix("image/") else { return nil }
            return LocalDataLayout.fileURL(in: localDataDir, relativePath: attachment.relativePath).path
        }
        return await Task.detached(priority: .utility) {
            paths.compactMap { UIImage(contentsOfFile: $0) }
        }.value
    }
}

struct ReplyingIndicatorView: View {
    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Replying…")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AssistantMessageView: View {
    let content: String
    var isStreaming = false
    var toolCalls: [ToolCallRecord]
    var onToolConfirm: ((ToolCallRecord, GatedToolAction) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !toolCalls.isEmpty {
                ToolCallsCardView(
                    toolCalls: toolCalls,
                    onToolConfirm: { call, action in onToolConfirm?(call, action) }
                )
            }
            if !content.isEmpty || isStreaming {
                Group {
                    if isStreaming || !UserMessageCard.looksLikeMarkdown(content) {
                        Text(content)
                            .font(.body)
                            .lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    } else {
                        HarnessMarkdownView(content: content, isStreaming: false)
                            .lineSpacing(4)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct UserMessageCard: View {
    let content: String
    var attachmentImages: [UIImage] = []
    @Binding var isExpanded: Bool

    private static let collapsedLineLimit = 5
    private static let approxCharsPerLine = 70

    static func looksLikeMarkdown(_ content: String) -> Bool {
        content.contains("```")
            || content.contains("**")
            || content.contains("](")
            || content.contains("\n- ")
            || content.contains("\n* ")
            || content.hasPrefix("#")
            || content.contains("\n#")
    }

    private var isOverflowing: Bool {
        guard !content.isEmpty else { return false }
        let newlineCount = content.reduce(0) { partial, char in
            partial + (char == "\n" ? 1 : 0)
        }
        if newlineCount >= Self.collapsedLineLimit { return true }
        return content.count > Self.collapsedLineLimit * Self.approxCharsPerLine
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !attachmentImages.isEmpty {
                attachmentStrip
            }

            if !content.isEmpty {
                ZStack(alignment: .bottom) {
                    userBody
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(isExpanded ? nil : Self.collapsedLineLimit)

                    if !isExpanded && isOverflowing {
                        LinearGradient(
                            colors: [
                                Color(.secondarySystemBackground).opacity(0),
                                Color(.secondarySystemBackground),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 38)
                        .allowsHitTesting(false)
                    }
                }

                if isOverflowing {
                    Button(isExpanded ? "Show less" : "Show more") {
                        toggleExpanded()
                    }
                    .font(.caption)
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onTapGesture {
            guard isOverflowing else { return }
            toggleExpanded()
        }
        .onChange(of: content) { _, _ in
            if isExpanded { isExpanded = false }
        }
    }

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(attachmentImages.enumerated()), id: \.offset) { _, image in
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 160, height: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
    }

    @ViewBuilder
    private var userBody: some View {
        if Self.looksLikeMarkdown(content) {
            HarnessMarkdownView(
                content: content,
                lineLimit: isExpanded ? nil : Self.collapsedLineLimit
            )
        } else {
            Text(content)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    private func toggleExpanded() {
        withAnimation(.easeInOut(duration: 0.2)) {
            isExpanded.toggle()
        }
    }
}

#Preview("Message Rows") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 16) {
            MessageRowView(
                message: MessageRecord(
                    role: "assistant",
                    content: "Added that to your task list.",
                    timestamp: nil,
                    model: OpenAIModel.chat,
                    toolCalls: [
                        ToolCallRecord(toolName: "task_create", payload: ["lastAction": "create"]),
                    ]
                ),
                onToolConfirm: { _, _ in }
            )
            MessageRowView(
                message: MessageRecord(
                    role: "user",
                    content: "Remind me to ship the iOS tasks view.",
                    timestamp: nil,
                    model: nil
                )
            )
            MessageRowView(
                message: MessageRecord(
                    role: "user",
                    content: """
                    This is a longer dictation that should clamp to five lines when collapsed. \
                    Tapping the card expands it so the rest stays readable. \
                    Keep packing: rain jacket, walking shoes, charger, notebook, and the gift for Alex. \
                    Also remind me to ping the team about the waveform polish before the TestFlight cut.
                    """,
                    timestamp: nil,
                    model: nil
                )
            )
        }
        .padding(16)
    }
    .background(Color(.systemGroupedBackground))
}
