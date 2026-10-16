// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "musetric-executor-view",
  platforms: [
    .iOS(.v14)
  ],
  products: [
    .library(
      name: "musetric-executor-view",
      type: .static,
      targets: ["musetric-executor-view"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "musetric-executor-view",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
