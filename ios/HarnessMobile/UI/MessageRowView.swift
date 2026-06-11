import SwiftUI

struct MessageRowView: View {
    let message: MessageRecord
    var isStreaming = false
    var toolCallsExpanded = false
    var onToggleToolCallsExpanded: (() -> Void)?
    var onToolConfirm: ((ToolCallRecord, GatedToolAction) -> Void)?
    @State private var isExpanded = false

    var body: some View {
        switch message.messageRole {
        case .assistant:
            AssistantMessageView(
                content: ChatTemporalContext.stripSentAtPrefix(message.content),
                isStreaming: isStreaming,
                toolCalls: message.toolCalls ?? [],
                toolCallsExpanded: toolCallsExpanded,
                onToggleToolCallsExpanded: onToggleToolCallsExpanded,
                onToolConfirm: onToolConfirm
            )
        case .user:
            UserMessageCard(content: message.content, isExpanded: $isExpanded)
        case .system:
            AssistantMessageView(
                content: message.content,
                isStreaming: isStreaming,
                toolCalls: message.toolCalls ?? [],
                toolCallsExpanded: toolCallsExpanded,
                onToggleToolCallsExpanded: onToggleToolCallsExpanded,
                onToolConfirm: onToolConfirm
            )
        }
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

private struct AssistantMessageView: View {
    let content: String
    var isStreaming = false
    var toolCalls: [ToolCallRecord]
    var toolCallsExpanded = false
    var onToggleToolCallsExpanded: (() -> Void)?
    var onToolConfirm: ((ToolCallRecord, GatedToolAction) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !toolCalls.isEmpty {
                ToolCallsCardView(
                    toolCalls: toolCalls,
                    expanded: toolCallsExpanded,
                    onToggleExpanded: { onToggleToolCallsExpanded?() },
                    onToolConfirm: { call, action in onToolConfirm?(call, action) }
                )
            }
            if !content.isEmpty || isStreaming {
                HarnessMarkdownView(content: content, isStreaming: isStreaming)
                    .lineSpacing(4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct UserMessageCard: View {
    let content: String
    @Binding var isExpanded: Bool
    @State private var isOverflowing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .bottom) {
                HarnessMarkdownView(content: content, lineLimit: isExpanded ? nil : 5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        GeometryReader { proxy in
                            Color.clear.preference(
                                key: UserMessageHeightKey.self,
                                value: proxy.size.height
                            )
                        }
                    )

                if !isExpanded && isOverflowing {
                    LinearGradient(
                        colors: [
                            Color(.secondarySystemGroupedBackground).opacity(0),
                            Color(.secondarySystemGroupedBackground),
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
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onPreferenceChange(UserMessageHeightKey.self) { height in
            guard !isExpanded else {
                isOverflowing = true
                return
            }
            let lineHeight: CGFloat = 24
            let maxCollapsedHeight = lineHeight * 5 + 8
            isOverflowing = height > maxCollapsedHeight + 1
        }
    }
}

private struct UserMessageHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
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
                onToggleToolCallsExpanded: {},
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
        }
        .padding(16)
    }
    .background(Color(.systemGroupedBackground))
}
