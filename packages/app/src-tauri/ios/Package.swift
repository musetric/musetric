// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "musetric-ios",
  platforms: [
    .iOS(.v14)
  ],
  products: [
    .library(
      name: "musetric-ios",
      type: .static,
      targets: ["musetric-ios"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "musetric-ios",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
