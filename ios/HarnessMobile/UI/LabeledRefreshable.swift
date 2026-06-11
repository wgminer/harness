import SwiftUI
import UIKit

extension View {
    /// Pull-to-refresh with a short label under the system spinner while pulling.
    func labeledRefreshable(
        _ label: String,
        action: @escaping () async -> Void
    ) -> some View {
        onAppear {
            RefreshControlLabelStyle.apply(label)
        }
        .refreshable(action: action)
    }
}

private enum RefreshControlLabelStyle {
    static func apply(_ text: String) {
        UIRefreshControl.appearance().attributedTitle = NSAttributedString(
            string: text,
            attributes: [
                .font: UIFont.preferredFont(forTextStyle: .footnote),
                .foregroundColor: UIColor.secondaryLabel,
            ]
        )
    }
}
