import Foundation
import SwiftUI

struct SyncStatusSnapshot: Equatable {
    enum Kind: Equatable {
        case idle
        case error
    }

    var kind: Kind
    var title: String
    var detail: String?
    var occurredAt: Date?

    var isVisible: Bool {
        kind != .idle
    }

    var showsAttentionDot: Bool {
        kind == .error
    }

    var symbolName: String {
        switch kind {
        case .idle:
            return "circle"
        case .error:
            return "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch kind {
        case .idle:
            return .secondary
        case .error:
            return .red
        }
    }
}
