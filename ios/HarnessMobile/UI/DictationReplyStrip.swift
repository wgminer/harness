import SwiftUI

struct DictationReplyStrip: View {
    var onContinue: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 0)
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
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }
}

#Preview("Dictation strip") {
    DictationReplyStrip(onContinue: {})
        .padding()
        .background(Color(.systemGroupedBackground))
}
