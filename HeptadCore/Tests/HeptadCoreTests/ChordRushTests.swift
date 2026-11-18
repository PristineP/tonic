import XCTest
@testable import HeptadCore

final class ChordRushTests: XCTestCase {
    func testPerfectRunScoresMaxAndGradeS() {
        var g = ChordRush()
        g.songIndex = 0
        g.arm()
        g.begin(atBeat: 0.3)
        XCTAssertEqual(g.startBeat, 8)
        for (i, d) in g.song.degrees.enumerated() {
            XCTAssertEqual(g.press(degree: d, atBeat: g.targetBeat(i) + 0.05), .perfect)
            g.advance(toBeat: g.targetBeat(i) + 1)
        }
        g.advance(toBeat: g.targetBeat(g.song.degrees.count - 1) + 4)
        XCTAssertEqual(g.phase, .done)
        XCTAssertEqual(g.score, g.maxScore)
        XCTAssertEqual(g.grade, "S")
        XCTAssertEqual(g.bestCombo, g.song.degrees.count)
    }

    func testTimingWindowsWrongKeysAndMisses() {
        var g = ChordRush()
        g.arm()
        g.begin(atBeat: 0)
        let d0 = g.song.degrees[0]
        XCTAssertNil(g.press(degree: d0, atBeat: g.targetBeat(0) - 1.5)) // far too early: ignored
        XCTAssertEqual(g.press(degree: d0, atBeat: g.targetBeat(0) + 0.3), .good)
        XCTAssertNil(g.press(degree: d0, atBeat: g.targetBeat(0) + 0.31)) // already judged
        XCTAssertEqual(g.press(degree: (g.song.degrees[1] + 1) % 7, atBeat: g.targetBeat(1)), .miss)
        XCTAssertEqual(g.combo, 0)
        // Chord 2 passes untouched.
        XCTAssertEqual(g.advance(toBeat: g.targetBeat(2) + 0.5), 1)
        XCTAssertEqual(g.results[2], .miss)
        XCTAssertEqual(g.score, 50)
    }

    func testAllSongsAreValid() {
        for s in ChordRush.songs {
            XCTAssertFalse(s.degrees.isEmpty)
            XCTAssertTrue(s.degrees.allSatisfy { (0..<7).contains($0) })
        }
    }
}
