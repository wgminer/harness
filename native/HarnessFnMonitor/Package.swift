// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "HarnessFnMonitor",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(
      name: "HarnessFnMonitor",
      path: "Sources/HarnessFnMonitor"
    ),
  ]
)
