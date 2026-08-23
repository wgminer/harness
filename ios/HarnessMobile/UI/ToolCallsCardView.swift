import SwiftUI

struct ToolCallsCardView: View {
    let toolCalls: [ToolCallRecord]
    var onToolConfirm: (ToolCallRecord, GatedToolAction) -> Void
    var onOpenThread: ((String) -> Void)?
    @State private var expanded = false

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
                    action: { expanded = true }
                )
            } else {
                if canCompress {
                    summaryRow(label: "Hide", chevron: "chevron.up", expanded: true, action: { expanded = false })
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

    @ViewBuilder
    private func toolRow(_ call: ToolCallRecord) -> some View {
        if call.toolName == "memory_search_conversations" {
            let hits = MemorySearchHit.array(from: call.payload)
            if !hits.isEmpty {
                searchToolRow(hits: hits)
            } else {
                defaultToolRow(call)
            }
        } else {
            defaultToolRow(call)
        }
    }

    private func searchToolRow(hits: [MemorySearchHit]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(ToolCallLabels.label(for: "memory_search_conversations"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(hits, id: \.id) { hit in searchHitRow(hit) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func defaultToolRow(_ call: ToolCallRecord) -> some View {
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
                        HapticFeedback.success()
                        onToolConfirm(call, .proceed)
                    }
                    .font(.caption.weight(.semibold))
                    Button("Cancel") {
                        HapticFeedback.warning()
                        onToolConfirm(call, .cancel)
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func searchHitRow(_ hit: MemorySearchHit) -> some View {
        let snippet = hit.excerpts?.first ?? hit.snippet ?? ""
        let canOpen = (hit.kind == .chat || hit.kind == .dictation) && onOpenThread != nil

        if canOpen, let onOpenThread {
            Button {
                onOpenThread(hit.id)
            } label: {
                searchHitLabel(hit: hit, snippet: snippet)
            }
            .buttonStyle(.plain)
        } else {
            searchHitLabel(hit: hit, snippet: snippet)
        }
    }

    private func searchHitLabel(hit: MemorySearchHit, snippet: String) -> some View {
        let kind: String = {
            switch hit.kind {
            case .dictation: return "Dictation"
            case .note: return "Note"
            case .image: return "Image"
            case .chat: return "Chat"
            }
        }()
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName(for: hit.kind))
                .font(.body)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(hit.title).font(.body.weight(.medium)).lineLimit(1)
                Text(snippet.isEmpty ? kind : "\(kind) · \(snippet)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func iconName(for kind: SearchResultKind) -> String {
        switch kind {
        case .dictation: return "mic.fill"
        case .note: return "note.text"
        case .image: return "photo"
        case .chat: return "bubble.left.and.bubble.right"
        }
    }

}

#Preview("Tool Calls") {
    VStack(spacing: 12) {
        ToolCallsCardView(
            toolCalls: [
                ToolCallRecord(toolName: "task_list", payload: ["lastAction": "list"]),
                ToolCallRecord(toolName: "task_create", payload: ["lastAction": "create"]),
            ],
            onToolConfirm: { _, _ in }
        )
        ToolCallsCardView(
            toolCalls: [
                ToolCallRecord(toolName: "task_delete", payload: ["pending": true, "tool": "task_delete"]),
            ],
            onToolConfirm: { _, _ in }
        )
    }
    .padding()
}
