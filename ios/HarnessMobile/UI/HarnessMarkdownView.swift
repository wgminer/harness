import MarkdownUI
import SwiftUI
import UIKit

struct HarnessMarkdownView: View {
    let content: String
    let lineLimit: Int?
    let isStreaming: Bool
    /// When true, use system serif + desktop-like size/line-height (assistant messages only).
    let assistantProse: Bool
    @Environment(\.colorScheme) private var colorScheme

    init(
        content: String,
        lineLimit: Int? = nil,
        isStreaming: Bool = false,
        assistantProse: Bool = false
    ) {
        self.content = content
        self.lineLimit = lineLimit
        self.isStreaming = isStreaming
        self.assistantProse = assistantProse
    }

    var body: some View {
        EquatableHarnessMarkdown(
            content: content,
            lineLimit: lineLimit,
            isStreaming: isStreaming,
            assistantProse: assistantProse,
            colorScheme: colorScheme
        )
        .equatable()
    }
}

private struct EquatableHarnessMarkdown: View, Equatable {
    let content: String
    let lineLimit: Int?
    let isStreaming: Bool
    let assistantProse: Bool
    let colorScheme: ColorScheme

    var body: some View {
        Markdown(content)
            .markdownTheme(assistantProse ? .harnessAssistantChat : .harnessChat)
            .markdownCodeSyntaxHighlighter(.harness(streaming: isStreaming, colorScheme: colorScheme))
            .lineLimit(lineLimit)
            .animation(nil, value: content)
    }
}

extension Theme {
    static let harnessChat = makeHarnessTheme(assistantProse: false)
    static let harnessAssistantChat = makeHarnessTheme(assistantProse: true)
}

/// Vertical rhythm shared by the theme and the streaming block stack.
enum HarnessMarkdownRhythm {
    /// Space after paragraphs and lists, relative to the body size.
    static let blockSpacingEm: CGFloat = 0.75
    /// Space between list items.
    static let listItemSpacingEm: CGFloat = 0.2
}

private func makeHarnessTheme(assistantProse: Bool) -> Theme {
    let lineSpacingEm = assistantProse ? AssistantProseStyle.lineSpacingEm : 0.22
    let blockSpacing = RelativeSize.em(HarnessMarkdownRhythm.blockSpacingEm)

    return Theme()
        .text {
            ForegroundColor(HarnessPalette.text)
            if assistantProse {
                FontFamily(.system(.serif))
                FontSize(AssistantProseStyle.basePointSize)
            } else {
                FontSize(.em(1.0))
            }
        }
        .strong {
            FontWeight(.semibold)
            ForegroundColor(HarnessPalette.textStrong)
        }
        .emphasis {
            FontStyle(.italic)
        }
        .link {
            ForegroundColor(HarnessPalette.accentReadable)
        }
        .code {
            FontFamily(.system(.monospaced))
            FontSize(.em(assistantProse ? 0.8 : 0.86))
            ForegroundColor(HarnessPalette.textStrong)
            BackgroundColor(HarnessPalette.control)
        }
        .heading1 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.12))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(assistantProse ? 1.32 : 1.2))
                    ForegroundColor(HarnessPalette.textStrong)
                }
                .markdownMargin(top: .em(1.3), bottom: .em(0.7))
        }
        .heading2 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.12))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(assistantProse ? 1.16 : 1.1))
                    ForegroundColor(HarnessPalette.textStrong)
                }
                .markdownMargin(top: .em(1.2), bottom: .em(0.65))
        }
        .heading3 { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.12))
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(.em(1.0))
                    ForegroundColor(HarnessPalette.textStrong)
                }
                .markdownMargin(top: .em(1.1), bottom: .em(0.65))
        }
        .heading4 { configuration in
            minorHeading(configuration)
        }
        .heading5 { configuration in
            minorHeading(configuration)
        }
        .heading6 { configuration in
            minorHeading(configuration)
        }
        .paragraph { configuration in
            configuration.label
                .relativeLineSpacing(.em(lineSpacingEm))
                .markdownMargin(top: .zero, bottom: blockSpacing)
        }
        .blockquote { configuration in
            HStack(alignment: .top, spacing: 0) {
                Rectangle()
                    .fill(HarnessPalette.rule)
                    .frame(width: 2)
                configuration.label
                    .markdownTextStyle {
                        ForegroundColor(HarnessPalette.textMuted)
                    }
                    .relativePadding(.leading, length: .em(0.9))
            }
            .fixedSize(horizontal: false, vertical: true)
            .markdownMargin(top: .zero, bottom: blockSpacing)
        }
        .list { configuration in
            configuration.label
                .markdownMargin(top: .zero, bottom: blockSpacing)
        }
        .listItem { configuration in
            configuration.label
                .relativeLineSpacing(.em(lineSpacingEm))
                .markdownMargin(top: .em(HarnessMarkdownRhythm.listItemSpacingEm))
        }
        .bulletedListMarker { configuration in
            Text(configuration.listLevel == 1 ? "\u{2022}" : "\u{25E6}")
                .foregroundStyle(HarnessPalette.textMuted)
                .relativeFrame(minWidth: .em(1.0), alignment: .trailing)
        }
        .numberedListMarker { configuration in
            Text("\(configuration.itemNumber).")
                .monospacedDigit()
                .foregroundStyle(HarnessPalette.textMuted)
                .relativeFrame(minWidth: .em(1.3), alignment: .trailing)
        }
        .taskListMarker { configuration in
            Image(systemName: configuration.isCompleted ? "checkmark.circle.fill" : "circle")
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(HarnessPalette.textMuted)
                .imageScale(.small)
                .relativeFrame(minWidth: .em(1.3), alignment: .trailing)
        }
        .codeBlock { configuration in
            HarnessCodeBlock(configuration: configuration, assistantProse: assistantProse)
                .markdownMargin(top: .em(0.4), bottom: .em(1.0))
        }
        .table { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .markdownTableBorderStyle(.init(color: HarnessPalette.hairline))
                .markdownTableBackgroundStyle(
                    .alternatingRows(HarnessPalette.background, HarnessPalette.surface)
                )
                .markdownMargin(top: .em(0.25), bottom: .em(1.0))
        }
        .tableCell { configuration in
            configuration.label
                .markdownTextStyle {
                    FontFamily(.system())
                    FontSize(.em(0.84))
                    if configuration.row == 0 {
                        FontWeight(.semibold)
                        ForegroundColor(HarnessPalette.textStrong)
                    }
                    BackgroundColor(nil)
                }
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.2))
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
        }
        .thematicBreak {
            Rectangle()
                .fill(HarnessPalette.hairline)
                .frame(height: 1)
                .markdownMargin(top: .em(1.2), bottom: .em(1.2))
        }
}

/// h4-h6: quiet sans labels so deep outlines never outshout the prose.
private func minorHeading(_ configuration: BlockConfiguration) -> some View {
    configuration.label
        .markdownTextStyle {
            FontFamily(.system())
            FontWeight(.semibold)
            FontSize(.em(0.82))
            ForegroundColor(HarnessPalette.textMuted)
        }
        .markdownMargin(top: .em(1.0), bottom: .em(0.4))
}

/// Fenced code: near-black well (desktop `.md-code-block`), SF Mono, language caption.
private struct HarnessCodeBlock: View {
    let configuration: CodeBlockConfiguration
    let assistantProse: Bool

    private var languageLabel: String? {
        guard let language = configuration.language?.trimmingCharacters(in: .whitespaces),
              !language.isEmpty
        else { return nil }
        return language.lowercased()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let languageLabel {
                Text(languageLabel)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(HarnessPalette.textFaint)
            }
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.4))
                .markdownTextStyle {
                    FontFamily(.system(.monospaced))
                    FontSize(.em(assistantProse ? 0.76 : 0.8))
                    ForegroundColor(HarnessPalette.textStrong)
                }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(HarnessPalette.well)
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(HarnessPalette.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onLongPressGesture {
            UIPasteboard.general.string = configuration.content
            HapticFeedback.success()
        }
        .accessibilityHint("Long press to copy")
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
                let description: String = "This is a very long line that should wrap inside the code block instead of scrolling horizontally."
            }
            ```
            """,
            assistantProse: true
        )
        .padding(20)
    }
}
