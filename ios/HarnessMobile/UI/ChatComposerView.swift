import SwiftUI

/// Message composer — liquid glass shell aligned with desktop `.chat-composer-inner`.
struct ChatComposerView: View {
    @Binding var text: String
    var isStreaming: Bool
    var focusTrigger: String
    var onSend: () -> Void
    var onStop: () -> Void

    @FocusState private var isFocused: Bool

    private let minTextHeight: CGFloat = 24
    private let maxTextLines = 8

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Type a message…", text: $text, axis: .vertical)
                .lineLimit(1 ... maxTextLines)
                .focused($isFocused)
                .font(.body)
                .textFieldStyle(.plain)
                .frame(minHeight: minTextHeight, alignment: .topLeading)
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
                    Button(action: onSend) {
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
        .composerGlassBackground()
        .task(id: focusTrigger) {
            try? await Task.sleep(for: .milliseconds(150))
            isFocused = true
        }
    }
}

// MARK: - Liquid glass surface (desktop `.surface-elevated-glass`)

private struct ComposerGlassBackground: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(
                                Color.primary.opacity(colorScheme == .dark ? 0.14 : 0.10),
                                lineWidth: 1
                            )
                    }
                    .overlay(alignment: .top) {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
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
    func composerGlassBackground() -> some View {
        modifier(ComposerGlassBackground())
    }
}

#Preview("Empty") {
    struct Host: View {
        @State private var text = ""
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    text: $text,
                    isStreaming: false,
                    focusTrigger: "preview",
                    onSend: {},
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
        @State private var text = "What should I pack for Tokyo in April?"
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    text: $text,
                    isStreaming: false,
                    focusTrigger: "preview",
                    onSend: {},
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
        @State private var text = ""
        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    text: $text,
                    isStreaming: true,
                    focusTrigger: "preview",
                    onSend: {},
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
