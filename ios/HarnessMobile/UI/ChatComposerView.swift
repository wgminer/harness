import SwiftUI

/// Message composer — liquid glass shell aligned with desktop `.chat-composer-inner`.
struct ChatComposerView: View {
    var conversationId: String
    var isStreaming: Bool
    var onSend: (String) -> Void
    var onStop: () -> Void

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
        .composerGlassBackground(cornerRadius: 20)
        .onChange(of: conversationId) { _, _ in
            draft = ""
        }
        .onChange(of: isStreaming) { _, streaming in
            if streaming {
                isFocused = false
            }
        }
        .task(id: conversationId) {
            draft = ""
            try? await Task.sleep(for: .milliseconds(150))
            isFocused = true
        }
    }

    private func submitDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isFocused = false
        draft = ""
        onSend(trimmed)
    }
}

// MARK: - Liquid glass surface (desktop `.surface-elevated-glass`)

private struct ComposerGlassBackground: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(
                                Color.primary.opacity(colorScheme == .dark ? 0.14 : 0.10),
                                lineWidth: 1
                            )
                    }
                    .overlay(alignment: .top) {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(
                                Color.white.opacity(colorScheme == .dark ? 0.12 : 0.35),
                                lineWidth: 1
                            )
                            .blur(radius: 0.5)
                            .mask {
                                LinearGradient(
                                    colors: [.white, .clear],
                                    startPoint: .top,
                                    endPoint: .center
                                )
                            }
                            .allowsHitTesting(false)
                    }
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.35 : 0.14), radius: 24, y: -6)
            }
    }
}

private extension View {
    func composerGlassBackground(cornerRadius: CGFloat = 20) -> some View {
        modifier(ComposerGlassBackground(cornerRadius: cornerRadius))
    }
}

#Preview("Empty") {
    struct Host: View {
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: false,
                    onSend: { _ in },
                    onStop: {}
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}

#Preview("With text") {
    struct Host: View {
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: false,
                    onSend: { _ in },
                    onStop: {}
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}

#Preview("Streaming") {
    struct Host: View {
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: true,
                    onSend: { _ in },
                    onStop: {}
                )
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}
