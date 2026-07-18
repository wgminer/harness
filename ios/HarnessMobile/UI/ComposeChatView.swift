import SwiftUI
import UIKit

struct ComposeChatView: View {
    @ObservedObject var app: AppModel

    @State private var sendError: String?
    @State private var showDictationSheet = false
    @State private var dictationConversationId: String?
    @State private var pendingImage: UIImage?
    @State private var showCamera = false
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
        .background(Color(.systemBackground).ignoresSafeArea())
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
        .onDisappear {
            app.flushComposerDrafts()
        }
        .sheet(isPresented: $showDictationSheet) {
            if let conversationId = dictationConversationId {
                DictationRecordingSheet(
                    app: app,
                    mode: .sendToConversation(conversationId: conversationId),
                    isPresented: $showDictationSheet,
                    onTranscriptSent: { transcript in
                        app.queueOutboundMessage(conversationId: conversationId, text: transcript)
                        app.openThread(id: conversationId)
                    }
                )
            }
        }
        .onChange(of: showDictationSheet) { _, isPresented in
            if !isPresented {
                dictationConversationId = nil
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPickerView(isPresented: $showCamera) { image in
                pendingImage = image
            }
            .ignoresSafeArea()
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
            isStreaming: false,
            autofocusOnAppear: true,
            startsExpanded: true,
            allowsCollapse: false,
            initialDraft: app.composeDraft,
            pendingImage: pendingImage,
            onDraftChange: { app.cacheComposeDraft($0) },
            onClearDraft: { app.clearComposeDraft() },
            onClearPendingImage: { pendingImage = nil },
            onSend: { payload in Task { await sendFirstMessage(payload) } },
            onStop: { app.chatService.stop() },
            onDictate: { startComposeDictation() },
            onCamera: { showCamera = true },
            isFocused: $isComposerFocused
        )
        .padding(.horizontal, BottomBarMetrics.horizontalInset)
        .padding(.bottom, BottomBarMetrics.bottomInset)
    }

    private func sendFirstMessage(_ payload: ComposerSendPayload) async {
        do {
            let id = try app.store.createConversation()
            app.queueOutboundMessage(
                conversationId: id,
                text: payload.text,
                imageJPEG: payload.imageJPEG
            )
            pendingImage = nil
            app.clearComposeDraft()
            app.openThread(id: id)
        } catch {
            sendError = error.localizedDescription
        }
    }

    private func startComposeDictation() {
        do {
            let id = try app.store.createConversation()
            dictationConversationId = id
            showDictationSheet = true
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
