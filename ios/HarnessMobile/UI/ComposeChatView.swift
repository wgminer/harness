import SwiftUI
import UIKit

struct ComposeChatView: View {
    @ObservedObject var app: AppModel
    @Environment(\.harnessTheme) private var theme

    @State private var sendError: String?
    @FocusState private var isComposerFocused: Bool

    private var headerQuote: String {
        HeaderQuotePolicy.homeHeaderQuote
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            if !headerQuote.isEmpty {
                Text(headerQuote)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(Self.quoteLineSpacing)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 32)
                    .frame(maxWidth: .infinity)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.bgColor.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerDock
        }
        .alert("Could not start chat", isPresented: .constant(sendError != nil)) {
            Button("OK") { sendError = nil }
        } message: {
            Text(sendError ?? "")
        }
    }

    private static var quoteLineSpacing: CGFloat {
        let font = UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .title2).pointSize, weight: .semibold)
        let targetLineHeight = font.pointSize * 1.5
        return max(0, targetLineHeight - font.lineHeight)
    }

    private var composerDock: some View {
        ChatComposerView(
            conversationId: "compose",
            isStreaming: app.chatService.isStreaming,
            autofocusOnAppear: true,
            startsExpanded: true,
            allowsCollapse: false,
            initialDraft: app.composeDraft,
            onDraftChange: { app.cacheComposeDraft($0) },
            onClearDraft: { app.clearComposeDraft() },
            onSend: { text in Task { await sendFirstMessage(text) } },
            onStop: { app.chatService.stop() },
            isFocused: $isComposerFocused
        )
        .animation(nil, value: isComposerFocused)
        .padding(.horizontal, BottomBarMetrics.horizontalInset)
        .padding(.bottom, BottomBarMetrics.bottomInset)
    }

    private func sendFirstMessage(_ text: String) async {
        do {
            let id = try app.store.createConversation()
            app.queueOutboundMessage(conversationId: id, text: text)
            app.clearComposeDraft()
            app.openThread(id: id)
        } catch {
            sendError = error.localizedDescription
        }
    }
}

#Preview("Compose") {
    PreviewNavigationRoot {
        ComposeChatView(app: PreviewSupport.emptyApp(syncNotConfigured: false, needsAPIKey: false))
    }
}
