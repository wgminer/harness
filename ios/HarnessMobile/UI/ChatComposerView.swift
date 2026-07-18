import SwiftUI
import UIKit

private enum ComposerLayout {
    static let textAreaMinHeight: CGFloat = 52
    static let pendingThumbnailSize: CGFloat = 72
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
    let pendingImage: UIImage?
    let onDraftChange: (String) -> Void
    let onClearDraft: () -> Void
    let onClearPendingImage: () -> Void
    let onSend: (ComposerSendPayload) -> Void
    let onStop: () -> Void
    let onDictate: (() -> Void)?
    let onCamera: (() -> Void)?

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
        pendingImage: UIImage? = nil,
        onDraftChange: @escaping (String) -> Void,
        onClearDraft: @escaping () -> Void,
        onClearPendingImage: @escaping () -> Void = {},
        onSend: @escaping (ComposerSendPayload) -> Void,
        onStop: @escaping () -> Void,
        onDictate: (() -> Void)? = nil,
        onCamera: (() -> Void)? = nil,
        isFocused: FocusState<Bool>.Binding
    ) {
        self.conversationId = conversationId
        self.isStreaming = isStreaming
        self.autofocusOnAppear = autofocusOnAppear
        self.startsExpanded = startsExpanded
        self.allowsCollapse = allowsCollapse
        self.initialDraft = initialDraft
        self.pendingImage = pendingImage
        self.onDraftChange = onDraftChange
        self.onClearDraft = onClearDraft
        self.onClearPendingImage = onClearPendingImage
        self.onSend = onSend
        self.onStop = onStop
        self.onDictate = onDictate
        self.onCamera = onCamera
        self._isFocused = isFocused
        _draft = State(initialValue: initialDraft)
        _heldExpanded = State(initialValue: startsExpanded)
    }

    private var hasText: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canSend: Bool {
        hasText || pendingImage != nil
    }

    private var isCollapsed: Bool {
        ComposerCollapsePolicy.isCollapsed(
            allowsCollapse: allowsCollapse,
            heldExpanded: heldExpanded,
            isFocused: isFocused
        )
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
            } else if ComposerCollapsePolicy.shouldReleaseExpanded(isFocused: focused) {
                heldExpanded = false
            }
        }
        .onChange(of: draft) { _, newValue in
            onDraftChange(newValue)
            if isFocused, !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                heldExpanded = true
            }
        }
        .onChange(of: pendingImage != nil) { _, hasImage in
            if hasImage {
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
                    HStack(spacing: 8) {
                        if pendingImage != nil {
                            Image(systemName: "photo")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        Text(ComposerCollapsePolicy.collapsedLabel(draft: draft))
                            .font(.body.weight(.semibold))
                            .foregroundStyle(canSend ? .primary : .secondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if let onCamera {
                    cameraButton(action: onCamera)
                }
                if let onDictate {
                    dictateButton(action: onDictate)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: ComposerLayout.collapsedHeight, alignment: .center)
        .padding(.horizontal, BottomBarMetrics.collapsedInnerHorizontal)
    }

    private func cameraButton(action: @escaping () -> Void) -> some View {
        Button {
            HapticFeedback.light()
            action()
        } label: {
            Image(systemName: "camera.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.primary.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Take photo")
    }

    private func dictateButton(action: @escaping () -> Void) -> some View {
        Button {
            HapticFeedback.medium()
            action()
        } label: {
            Image(systemName: "mic.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.red))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Dictate")
    }

    private var stopButton: some View {
        Button {
            HapticFeedback.medium()
            onStop()
        } label: {
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
            if let pendingImage {
                pendingImageRow(pendingImage)
                    .padding(.horizontal, 14)
                    .padding(.top, 14)
            }

            TextField("Type a message…", text: $draft, axis: .vertical)
                .lineLimit(1 ... 8)
                .focused($isFocused)
                .font(.body)
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity, minHeight: ComposerLayout.textAreaMinHeight, alignment: .topLeading)
                .disabled(isStreaming)
                .padding(.horizontal, 18)
                .padding(.top, pendingImage == nil ? 18 : 10)
                .padding(.bottom, 10)

            HStack(alignment: .center, spacing: 12) {
                if let onCamera, !isStreaming {
                    cameraButton(action: onCamera)
                }

                Spacer(minLength: 0)

                if isStreaming {
                    stopButton
                } else if canSend {
                    Button {
                        submitDraft()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Color(.systemBackground))
                            .frame(width: 36, height: 36)
                            .background(
                                Circle()
                                    .fill(Color.accentColor)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Send message")
                } else if let onDictate {
                    dictateButton(action: onDictate)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
        }
    }

    private func pendingImageRow(_ image: UIImage) -> some View {
        ZStack(alignment: .topTrailing) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: ComposerLayout.pendingThumbnailSize, height: ComposerLayout.pendingThumbnailSize)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            Button {
                HapticFeedback.light()
                onClearPendingImage()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color.black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .offset(x: 6, y: -6)
            .accessibilityLabel("Remove photo")
        }
    }

    private func releaseExpandedIfIdle() {
        guard ComposerCollapsePolicy.shouldReleaseExpanded(isFocused: isFocused) else { return }
        heldExpanded = false
    }

    private func scheduleAutofocus() {
        DispatchQueue.main.async {
            isFocused = true
        }
    }

    private func submitDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let jpeg = pendingImage.flatMap { ChatImageNormalizer.jpegData(from: $0) }
        guard !trimmed.isEmpty || jpeg != nil else { return }
        HapticFeedback.light()
        isFocused = false
        heldExpanded = false
        draft = ""
        onClearDraft()
        onClearPendingImage()
        onSend(ComposerSendPayload(text: trimmed, imageJPEG: jpeg))
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
