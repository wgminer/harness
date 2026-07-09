import SwiftUI
import UIKit

private enum ComposerLayout {
    static let textAreaMinHeight: CGFloat = 52
    /// One line of body text plus collapsed vertical padding.
    static var collapsedHeight: CGFloat {
        let font = UIFont.preferredFont(forTextStyle: .body)
        return font.lineHeight + BottomBarMetrics.collapsedInnerVertical * 2
    }
}

/// Message composer for chat threads.
struct ChatComposerView: View {
    let conversationId: String
    let isStreaming: Bool
    let autofocusOnAppear: Bool
    /// When true, requests keyboard focus on appear (compose screen, pending outbound).
    let startsExpanded: Bool
    let allowsCollapse: Bool
    let initialDraft: String
    let onDraftChange: (String) -> Void
    let onClearDraft: () -> Void
    let onSend: (String) -> Void
    let onStop: () -> Void

    @FocusState.Binding var isFocused: Bool

    @State private var draft = ""
    /// Bridges collapsed → expanded until the TextField mounts and accepts focus.
    @State private var heldExpanded = false

    init(
        conversationId: String,
        isStreaming: Bool,
        autofocusOnAppear: Bool,
        startsExpanded: Bool,
        allowsCollapse: Bool,
        initialDraft: String,
        onDraftChange: @escaping (String) -> Void,
        onClearDraft: @escaping () -> Void,
        onSend: @escaping (String) -> Void,
        onStop: @escaping () -> Void,
        isFocused: FocusState<Bool>.Binding
    ) {
        self.conversationId = conversationId
        self.isStreaming = isStreaming
        self.autofocusOnAppear = autofocusOnAppear
        self.startsExpanded = startsExpanded
        self.allowsCollapse = allowsCollapse
        self.initialDraft = initialDraft
        self.onDraftChange = onDraftChange
        self.onClearDraft = onClearDraft
        self.onSend = onSend
        self.onStop = onStop
        self._isFocused = isFocused
        _draft = State(initialValue: initialDraft)
        _heldExpanded = State(initialValue: startsExpanded)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isCollapsed: Bool {
        guard allowsCollapse else { return false }
        return !heldExpanded && !isFocused && !canSend
    }

    private var cornerRadius: CGFloat {
        isCollapsed ? BottomBarMetrics.collapsedCornerRadius : BottomBarMetrics.expandedCornerRadius
    }

    var body: some View {
        Group {
            if isCollapsed {
                collapsedContent
            } else {
                expandedContent
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidGlassSurface(cornerRadius: cornerRadius, shadowOffsetY: -6)
        .onChange(of: isStreaming) { _, streaming in
            if streaming {
                isFocused = false
                heldExpanded = false
            } else if !canSend {
                releaseExpandedIfIdle()
            }
        }
        .onChange(of: isFocused) { _, focused in
            if focused {
                heldExpanded = true
            } else {
                releaseExpandedIfIdle()
            }
        }
        .onChange(of: draft) { _, newValue in
            onDraftChange(newValue)
            if !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                heldExpanded = true
            }
        }
        .onAppear {
            if autofocusOnAppear || startsExpanded {
                heldExpanded = true
                scheduleAutofocus()
            }
        }
    }

    private var collapsedContent: some View {
        HStack(spacing: 12) {
            if isStreaming {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Replying…")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                stopButton
            } else {
                Button {
                    heldExpanded = true
                    isFocused = true
                } label: {
                    HStack(spacing: 0) {
                        Text("Type a message…")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: ComposerLayout.collapsedHeight, alignment: .center)
        .padding(.horizontal, BottomBarMetrics.collapsedInnerHorizontal)
    }

    private var stopButton: some View {
        Button(action: onStop) {
            Text("Stop")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.primary.opacity(0.08))
                )
        }
        .buttonStyle(.plain)
    }

    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Type a message…", text: $draft, axis: .vertical)
                .lineLimit(1 ... 8)
                .focused($isFocused)
                .font(.body)
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: ComposerLayout.textAreaMinHeight, alignment: .topLeading)
                .disabled(isStreaming)
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, 10)

            HStack(alignment: .center, spacing: 12) {
                Spacer(minLength: 0)

                if isStreaming {
                    stopButton
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
    }

    private func releaseExpandedIfIdle() {
        guard !isFocused, !canSend else { return }
        heldExpanded = false
    }

    private func scheduleAutofocus() {
        DispatchQueue.main.async {
            isFocused = true
        }
    }

    private func submitDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isFocused = false
        heldExpanded = false
        draft = ""
        onClearDraft()
        onSend(trimmed)
    }
}

#Preview("Composer streaming collapsed") {
    struct Host: View {
        @FocusState private var isFocused: Bool

        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: true,
                    autofocusOnAppear: false,
                    startsExpanded: false,
                    allowsCollapse: true,
                    initialDraft: "",
                    onDraftChange: { _ in },
                    onClearDraft: {},
                    onSend: { _ in },
                    onStop: {},
                    isFocused: $isFocused
                )
                .padding(.horizontal, BottomBarMetrics.horizontalInset)
                .padding(.bottom, BottomBarMetrics.bottomInset)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}

#Preview("Composer collapsed") {
    struct Host: View {
        @FocusState private var isFocused: Bool

        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: false,
                    autofocusOnAppear: false,
                    startsExpanded: false,
                    allowsCollapse: true,
                    initialDraft: "",
                    onDraftChange: { _ in },
                    onClearDraft: {},
                    onSend: { _ in },
                    onStop: {},
                    isFocused: $isFocused
                )
                .padding(.horizontal, BottomBarMetrics.horizontalInset)
                .padding(.bottom, BottomBarMetrics.bottomInset)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}

#Preview("Composer expanded") {
    struct Host: View {
        @FocusState private var isFocused: Bool

        var body: some View {
            VStack {
                Spacer()
                ChatComposerView(
                    conversationId: "preview",
                    isStreaming: false,
                    autofocusOnAppear: true,
                    startsExpanded: true,
                    allowsCollapse: true,
                    initialDraft: "",
                    onDraftChange: { _ in },
                    onClearDraft: {},
                    onSend: { _ in },
                    onStop: {},
                    isFocused: $isFocused
                )
                .padding(.horizontal, BottomBarMetrics.horizontalInset)
                .padding(.bottom, BottomBarMetrics.bottomInset)
            }
            .background(Color(.systemGroupedBackground))
        }
    }
    return Host()
}
