import HiChordCore
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var showHelp = false
    @AppStorage("hichord.seenWelcome") private var seenWelcome = false

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            ZStack {
                Backdrop()
                if landscape {
                    landscapeLayout(geo.size)
                } else {
                    portraitLayout(geo.size)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView().environment(model)
        }
        .sheet(isPresented: $showHelp, onDismiss: { seenWelcome = true }) {
            HelpView().environment(model)
        }
        .onAppear {
            if !seenWelcome { showHelp = true }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-uiSettings") { showSettings = true }
            #endif
        }
        .alert("Microphone access is off", isPresented: Binding(get: { model.micDenied && model.settings.mode.usesMicrophone },
                                                                 set: { _ in model.setMode(.play) })) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                model.setMode(.play)
            }
            Button("Not Now", role: .cancel) { model.setMode(.play) }
        } message: {
            Text("The tuner and sampler need the microphone. You can allow it in Settings.")
        }
    }

    private var topBar: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 1) {
                Text(model.settings.mode.displayName)
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                Text("\(NoteNames.keyName(model.settings.harmony.key)) \(model.settings.harmony.scale.displayName.capitalized) · \(model.settings.soundName.capitalized)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }
            Spacer()
            if model.midiEnabled {
                Label("MIDI", systemImage: "pianokeys")
                    .labelStyle(.titleAndIcon)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.4))
                    .accessibilityLabel("MIDI output on")
            }
            Button { showHelp = true } label: {
                Image(systemName: "questionmark.circle")
            }
            .accessibilityLabel("Guide")
            Button { showSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
            }
            .accessibilityLabel("Settings")
        }
        .font(.system(size: 20, weight: .medium))
        .foregroundStyle(.white.opacity(0.8))
    }

    private func portraitLayout(_ size: CGSize) -> some View {
        let width = min(size.width - 24, 640)
        let joystick = min(width * 0.42, max(120, size.height * 0.22))
        return VStack(spacing: 18) {
            topBar
                .frame(width: width)
                .padding(.top, 4)
            Spacer(minLength: 0)
            DeviceView()
                .frame(width: width)
            Spacer(minLength: 0)
            HStack(alignment: .center, spacing: 14) {
                JoystickView(map: model.settings.harmony.joystickMap,
                             direction: model.joystick,
                             onDirection: { model.setJoystick($0) },
                             onClick: { model.clickJoystick() })
                    .frame(width: joystick, height: joystick)
                LooperPanel(vertical: true)
            }
            .frame(width: width)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(width: size.width, height: size.height)
    }

    private func landscapeLayout(_ size: CGSize) -> some View {
        let deviceHeight = min(size.height - 70, (size.width - 360) / DeviceView.aspect)
        let deviceWidth = deviceHeight * DeviceView.aspect
        let side = max(140, min(220, (size.width - deviceWidth) / 2 - 24))
        return VStack(spacing: 10) {
            topBar
                .padding(.horizontal, 8)
            HStack(spacing: 16) {
                JoystickView(map: model.settings.harmony.joystickMap,
                             direction: model.joystick,
                             onDirection: { model.setJoystick($0) },
                             onClick: { model.clickJoystick() })
                    .frame(width: side, height: side)
                DeviceView()
                    .frame(width: deviceWidth, height: deviceHeight)
                LooperPanel(vertical: true)
                    .frame(width: side)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(width: size.width, height: size.height)
    }
}
