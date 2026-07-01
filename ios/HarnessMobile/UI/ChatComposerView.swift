import SwiftUI

private enum ComposerLayout {
    static let textAreaMinHeight: CGFloat = 52
    /// Delay keyboard until navigation transition finishes (compose screen).
    static let autofocusDelayNs: UInt64 = 400_000_000
}

/// Message composer for chat threads.
struct ChatComposerView: View {
    let conversationId: String
    let isStreaming: Bool
    let autofocusOnAppear: Bool
    /// When true, mounts expanded and stays expanded until the user dismisses an empty draft.
    let startsExpanded: Bool
    let allowsCollapse: Bool
    let initialDraft: String
    let onDraftChange: (String) -> Void
    let onClearDraft: () -> Void
    let onSend: (String) -> Void
    let onStop: () -> Void

    @FocusState.Binding var isFocused: Bool

    @State private var draft = ""
    @State private var shouldFocusOnExpand = false
    /// Keeps the composer expanded while focus moves from the collapsed tap target to the TextField.
    @State private var isExpandedByUser = false

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
        _isExpandedByUser = State(initialValue: startsExpanded)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isExpanded: Bool {
        !allowsCollapse || isExpandedByUser || isFocused || canSend || isStreaming
    }

    private var cornerRadius: CGFloat {
        isExpanded ? BottomBarMetrics.expandedCornerRadius : BottomBarMetrics.collapsedCornerRadius
    }

    var body: some View {
        Group {
            if isExpanded {
                expandedContent
                    .transition(allowsCollapse ? .opacity : .identity)
            } else {
                collapsedContent
                    .transition(allowsCollapse ? .opacity : .identity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidGlassSurface(cornerRadius: cornerRadius, shadowOffsetY: -6)
        .animation(allowsCollapse ? .smooth(duration: 0.3) : nil, value: isExpanded)
        .animation(nil, value: isFocused)
        .animation(nil, value: isStreaming)
        .animation(nil, value: canSend)
        .onChange(of: isStreaming) { _, streaming in
            if streaming {
                isFocused = false
            }
        }
        .onChange(of: isFocused) { _, focused in
            if !focused, !canSend, !isStreaming {
                isExpandedByUser = false
            }
        }
        .onChange(of: isExpanded) { _, expanded in
            guard expanded, shouldFocusOnExpand else { return }
            shouldFocusOnExpand = false
            // TextField mounts after expand; re-assert focus on the next run loop.
            Task { @MainActor in
                isFocused = true
            }
        }
        .onChange(of: draft) { _, newValue in
            onDraftChange(newValue)
        }
        .onAppear {
            if autofocusOnAppear {
                isExpandedByUser = true
                scheduleAutofocus()
            }
        }
    }

    private var collapsedContent: some View {
        Button {
            expandAndFocus()
        } label: {
            HStack(spacing: 0) {
                Text(draft.isEmpty ? "Type a message…" : draft)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(draft.isEmpty ? .secondary : .primary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, BottomBarMetrics.collapsedInnerHorizontal)
            .padding(.vertical, BottomBarMetrics.collapsedInnerVertical)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                TextField("Type a message…", text: $draft, axis: .vertical)
                    .lineLimit(1 ... 8)
                    .focused($isFocused)
                    .font(.body)
                    .textFieldStyle(.plain)
                    .frame(maxWidth: .infinity, minHeight: ComposerLayout.textAreaMinHeight, alignment: .topLeading)
                    .disabled(isStreaming)

                if !isFocused, !isStreaming {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {
                            expandAndFocus()
                        }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 10)

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
    }

    private func expandAndFocus() {
        isExpandedByUser = true
        shouldFocusOnExpand = true
    }

    private func scheduleAutofocus() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: ComposerLayout.autofocusDelayNs)
            shouldFocusOnExpand = true
            if isExpanded {
                shouldFocusOnExpand = false
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
