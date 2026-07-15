import VisionKit
import SwiftUI

/// Camera QR scanner using VisionKit DataScanner (iOS 17+).
struct PairingCodeScannerView: UIViewControllerRepresentable {
    var onCode: (String) -> Void
    var onUnavailable: () -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
            try? uiViewController.startScanning()
        } else {
            onUnavailable()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var handled = false

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didTapOn item: RecognizedItem
        ) {
            handle(item)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard let first = addedItems.first else { return }
            handle(first)
        }

        private func handle(_ item: RecognizedItem) {
            guard !handled else { return }
            if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
                handled = true
                onCode(value)
            }
        }
    }
}
