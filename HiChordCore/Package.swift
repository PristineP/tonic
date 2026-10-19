// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "HiChordCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HiChordCore", targets: ["HiChordCore"]),
    ],
    targets: [
        .target(name: "CHiChordAtomics"),
        .target(name: "HiChordCore", dependencies: ["CHiChordAtomics"]),
        .testTarget(name: "HiChordCoreTests", dependencies: ["HiChordCore"]),
    ]
)
