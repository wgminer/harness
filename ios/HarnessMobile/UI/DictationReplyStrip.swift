import SwiftUI

struct DictationReplyStrip: View {
    var label: String
    var loading: Bool
    var disabled: Bool = false
    var onSelect: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            Group {
                if loading {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityIdentifier("dictation-suggested-prompts-loading")
                } else {
                    Button {
                        HapticFeedback.medium()
                        onSelect()
                    } label: {
                        Text(label)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(HarnessPalette.text)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                Capsule(style: .continuous)
                                    .strokeBorder(HarnessPalette.hairline, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(disabled)
                    .accessibilityIdentifier("dictation-suggested-prompt")
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
        .accessibilityIdentifier("dictation-suggested-prompts")
    }
}

#Preview("Dictation strip") {
    DictationReplyStrip(label: "Distill", loading: false, onSelect: {})
        .padding()
        .background(HarnessPalette.background)
}
