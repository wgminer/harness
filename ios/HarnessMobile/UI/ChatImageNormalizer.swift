import UIKit

enum ChatImageNormalizer {
    static let maxEdge: CGFloat = 2048
    static let jpegQuality: CGFloat = 0.7

    /// Downscale so the longest edge is at most `maxEdge`, then encode as JPEG.
    static func jpegData(from image: UIImage) -> Data? {
        let normalized = image.normalizedOrientation()
        let scaled = normalized.scaledToMaxEdge(Self.maxEdge)
        return scaled.jpegData(compressionQuality: Self.jpegQuality)
    }
}

private extension UIImage {
    func normalizedOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }

    func scaledToMaxEdge(_ maxEdge: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxEdge, longest > 0 else { return self }
        let scale = maxEdge / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
