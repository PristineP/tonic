import XCTest

/// Drives the real app UI in the simulator.
final class HiChordUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // Skip the first-launch guide via the UserDefaults argument domain.
        app.launchArguments += ["-hichord.seenWelcome", "YES", "-hichord.settings.v1", ""]
    }

    private var display: XCUIElement { app.descendants(matching: .any)["oled"] }

    private func waitForDisplay(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let predicate = NSPredicate(format: "value CONTAINS %@", text)
        let exp = expectation(for: predicate, evaluatedWith: display)
        let result = XCTWaiter.wait(for: [exp], timeout: 5)
        XCTAssertEqual(result, .completed, "display shows “\(display.value ?? "")”, expected “\(text)”", file: file, line: line)
    }

    private func attachScreenshot(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testPlayingChordKeysUpdatesTheDisplay() {
        app.launch()
        XCTAssertTrue(display.waitForExistence(timeout: 10))
        app.buttons["Chord VI, Am"].press(forDuration: 0.3)
        waitForDisplay("Am")
        app.buttons["Chord IV, F"].press(forDuration: 0.3)
        waitForDisplay("F")
        attachScreenshot("played-chords")
    }

    func testFunctionKeysOpenMenus() {
        app.launch()
        XCTAssertTrue(display.waitForExistence(timeout: 10))
        app.buttons["Key"].tap()
        waitForDisplay("Key C")
        app.buttons["Key"].tap()
        app.buttons["Sound"].tap()
        waitForDisplay("Sound")
        app.buttons["Sound"].tap()
        app.buttons["Mode"].tap()
        waitForDisplay("Mode PLAY")
        attachScreenshot("mode-menu")
    }

    func testLooperArmsATrack() {
        app.launch()
        let track = app.buttons["Loop track 1"]
        XCTAssertTrue(track.waitForExistence(timeout: 10))
        track.tap()
        let armed = NSPredicate(format: "value IN %@", ["Waiting to record", "Recording"])
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: armed, evaluatedWith: track)], timeout: 5), .completed)
        app.buttons["Clear all loops"].tap()
        let empty = NSPredicate(format: "value == %@", "Empty")
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: empty, evaluatedWith: track)], timeout: 5), .completed)
    }

    func testSettingsSheetOpensAndCloses() {
        app.launch()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        attachScreenshot("settings")
        app.buttons["Done"].tap()
        XCTAssertTrue(display.waitForExistence(timeout: 5))
    }

    func testGuideShowsOnFirstLaunch() {
        app.launchArguments = ["-hichord.seenWelcome", "NO"]
        app.launch()
        XCTAssertTrue(app.navigationBars["HiChord Guide"].waitForExistence(timeout: 10))
        app.buttons["Start playing"].tap()
        XCTAssertTrue(display.waitForExistence(timeout: 5))
    }

    func testLandscapeLayoutIsPlayable() {
        app.launch()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let key = app.buttons["Chord I, C"]
        XCTAssertTrue(key.waitForExistence(timeout: 10))
        XCTAssertTrue(key.isHittable)
        key.press(forDuration: 0.3)
        waitForDisplay("C")
        XCTAssertTrue(app.buttons["Loop track 6"].isHittable)
        attachScreenshot("landscape")
    }
}
