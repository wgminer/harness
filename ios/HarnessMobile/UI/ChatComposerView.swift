import SwiftUI

/// Message composer for chat threads.
struct ChatComposerView: View {
    let conversationId: String
    let isStreaming: Bool
    let autofocusOnAppear: Bool
    let initialDraft: String
    let onDraftChange: (String) -> Void
    let onClearDraft: () -> Void
    let onSend: (String) -> Void
    let onStop: () -> Void

    @State private var draft = ""
    @FocusState private var isFocused: Bool

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Type a message…", text: $draft, axis: .vertical)
                .lineLimit(1 ... 8)
                .focused($isFocused)
                .font(.body)
                .textFieldStyle(.plain)
                .frame(minHeight: 24, alignment: .topLeading)
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 10)
                .disabled(isStreaming)

            HStack(alignment: .center, spacing: 12) {
                Spacer(minLength: 0)

                if isStreaming {
                    Button(action: onStop) {
                        Text("Stop")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(Color.primary.opacity(0.08))
                            )
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        submitDraft()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(canSend ? Color(.systemBackground) : Color.secondary)
                            .frame(width: 36, height: 36)
                            .background(
                                Circle()
                                    .fill(canSend ? Color.accentColor : Color.primary.opacity(0.12))
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .accessibilityLabel("Send message")
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidGlassSurface(
            cornerRadius: BottomBarMetrics.expandedCornerRadius,
            shadowOffsetY: -6
        )
        .animation(nil, value: isStreaming)
        .animation(nil, value: canSend)
        .onChange(of: isStreaming) { _, streaming in
            if streaming {
                isFocused = false
            }
        }
        .onChange(of: draft) { _, newValue in
            onDraftChange(newValue)
        }
        .onAppear {
            draft = initialDraft
            if autofocusOnAppear {
                isFocused = true
            }
        }
    }

    private func submitDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isFocused = false
        draft = ""
        onClearDraft()
        onSend(trimmed)
    }
}

#Preview("Composer") {
    struct Host: View {
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: false,
                    autofocusOnAppear: false,
                    initialDraft: "",
                    onDraftChange: { _ in },
                    onClearDraft: {},
                    onSend: { _ in },
                    onStop: {}
                )
                .padding(.horizontal, BottomBarMetrics.horizontalInset)
                .padding(.bottom, BottomBarMetrics.bottomInset)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}
