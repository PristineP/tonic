// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "HeptadCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HeptadCore", targets: ["HeptadCore"]),
    ],
    targets: [
        .target(name: "CHeptadAtomics"),
        .target(name: "HeptadCore", dependencies: ["CHeptadAtomics"]),
        .testTarget(name: "HeptadCoreTests", dependencies: ["HeptadCore"]),
    ]
)
