import SwiftUI

struct DictationReplyStrip: View {
    var showPolish: Bool
    var onContinue: () -> Void
    var onPolish: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if showPolish {
                Button(action: onPolish) {
                    Text("Polish")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            Capsule(style: .continuous)
                                .fill(Color.primary.opacity(0.08))
                        )
                }
                .buttonStyle(.plain)
            }

            Button(action: onContinue) {
                Text(DictationReplyLabel.continueLabel)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        Capsule(style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.25), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat-generate-reply")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }
}

#Preview("Dictation strip") {
    DictationReplyStrip(showPolish: true, onContinue: {}, onPolish: {})
        .padding()
        .background(Color(.systemGroupedBackground))
}
