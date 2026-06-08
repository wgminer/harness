import SwiftUI

struct ToolCallsCardView: View {
    let toolCalls: [ToolCallRecord]
    var expanded: Bool
    var onToggleExpanded: () -> Void
    var onToolConfirm: (ToolCallRecord, GatedToolAction) -> Void

    private var hasPending: Bool {
        toolCalls.contains(where: \.isPending)
    }

    private var canCompress: Bool {
        toolCalls.count >= ToolCallLabels.compressThreshold
    }

    private var compressed: Bool {
        canCompress && !expanded && !hasPending
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if compressed {
                summaryRow(
                    label: ToolCallLabels.summarize(toolCalls),
                    chevron: "chevron.down",
                    expanded: false,
                    action: onToggleExpanded
                )
            } else {
                if canCompress {
                    summaryRow(label: "Hide", chevron: "chevron.up", expanded: true, action: onToggleExpanded)
                }
                ForEach(Array(toolCalls.enumerated()), id: \.offset) { _, call in
                    toolRow(call)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func summaryRow(label: String, chevron: String, expanded: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: chevron)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(expanded ? "Hide tool actions" : "Show tool actions")
    }

    private func toolRow(_ call: ToolCallRecord) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(ToolCallLabels.label(for: call.toolName))
                .font(.subheadline)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if call.isPending {
                HStack(spacing: 8) {
                    Button("Proceed") {
                        onToolConfirm(call, .proceed)
                    }
                    .font(.caption.weight(.semibold))
                    Button("Cancel") {
                        onToolConfirm(call, .cancel)
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview("Tool Calls") {
    VStack(spacing: 12) {
        ToolCallsCardView(
            toolCalls: [
                ToolCallRecord(toolName: "task_list", payload: ["lastAction": "list"]),
                ToolCallRecord(toolName: "task_create", payload: ["lastAction": "create"]),
            ],
            expanded: false,
            onToggleExpanded: {},
            onToolConfirm: { _, _ in }
        )
        ToolCallsCardView(
            toolCalls: [
                ToolCallRecord(toolName: "task_delete", payload: ["pending": true, "tool": "task_delete"]),
            ],
            expanded: true,
            onToggleExpanded: {},
            onToolConfirm: { _, _ in }
        )
    }
    .padding()
}
