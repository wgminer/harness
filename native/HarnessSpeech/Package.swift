// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "HarnessSpeech",
  platforms: [.macOS(.v14)],
  dependencies: [
    // `traits: []` drops FluidAudio's TTS, diarizer and the prebuilt NemoTextProcessing
    // xcframework (a GitHub release download). Traits need tools 6.2: SwiftPM 6.1 still
    // links trait-conditioned binary targets.
    .package(
      url: "https://github.com/FluidInference/FluidAudio.git",
      .upToNextMinor(from: "0.17.7"),
      traits: []
    ),
  ],
  targets: [
    .executableTarget(
      name: "HarnessSpeech",
      dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
      path: "Sources/HarnessSpeech",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
