import MarkdownUI
import SwiftUI

struct HarnessMarkdownView: View {
    let content: String
    let lineLimit: Int?
    let isStreaming: Bool

    init(content: String, lineLimit: Int? = nil, isStreaming: Bool = false) {
        self.content = content
        self.lineLimit = lineLimit
        self.isStreaming = isStreaming
    }

    var body: some View {
        Markdown(content)
            .markdownTheme(.harnessChat)
            .markdownCodeSyntaxHighlighter(.harness(streaming: isStreaming))
            .lineLimit(lineLimit)
            .animation(nil, value: content)
    }
}

extension Theme {
    static let harnessChat = Theme()
        .text {
            FontSize(.em(1.0))
        }
        .strong {
            FontWeight(.semibold)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
            BackgroundColor(.gray.opacity(0.22))
        }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .heading4 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .heading5 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .heading6 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                }
                .markdownMargin(top: 0, bottom: 12)
        }
        .paragraph { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 12)
        }
        .listItem { configuration in
            configuration.label
                .markdownMargin(top: 2, bottom: 2)
        }
        .codeBlock { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .relativeLineSpacing(.em(0.2))
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(.em(0.9))
                    }
                    .padding(12)
            }
            .background(Color(.tertiarySystemGroupedBackground))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .markdownMargin(top: 10, bottom: 10)
        }
}

#Preview("Harness Markdown") {
    ScrollView {
        HarnessMarkdownView(
            content: """
            ### Packing list
            This is **bold** text with `inline code`.

            - Light rain jacket
            - Walking shoes

            ```swift
            struct Demo {
                let value: Int
            }
            ```
            """
        )
        .padding(20)
    }
    .preferredColorScheme(.dark)
}
