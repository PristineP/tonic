import SwiftUI

@main
struct TonicApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .preferredColorScheme(.dark)
                .statusBarHidden(false)
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
                .onAppear { model.start() }
                .onChange(of: scenePhase) { _, phase in
                    model.scenePhaseChanged(phase)
                }
        }
    }
}
