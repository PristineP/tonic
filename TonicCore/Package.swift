// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TonicCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TonicCore", targets: ["TonicCore"]),
    ],
    targets: [
        .target(name: "CTonicAtomics"),
        .target(name: "TonicCore", dependencies: ["CTonicAtomics"]),
        .testTarget(name: "TonicCoreTests", dependencies: ["TonicCore"]),
    ]
)
