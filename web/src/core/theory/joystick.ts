/** The eight joystick directions, plus centre. */
export enum JoyDirection { center, up, upRight, right, downRight, down, downLeft, left, upLeft }

export namespace JoyDirection {
  export const allCases: JoyDirection[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]

  /** Maps a 2-D deflection (x right, y up) to a direction. Returns `.center` inside the dead zone. */
  export function from(x: number, y: number, deadZone = 0.35): JoyDirection {
    const mag = Math.sqrt(x * x + y * y)
    if (!(mag >= deadZone)) return JoyDirection.center
    let angle = (Math.atan2(y, x) * 180) / Math.PI // 0 = right, 90 = up
    if (angle < 0) angle += 360
    const sector = Math.trunc((angle + 22.5) / 45) % 8
    const order = [
      JoyDirection.right, JoyDirection.upRight, JoyDirection.up, JoyDirection.upLeft,
      JoyDirection.left, JoyDirection.downLeft, JoyDirection.down, JoyDirection.downRight,
    ]
    return order[sector]
  }

  /** Unit vector for drawing. */
  export function vector(d: JoyDirection): { x: number; y: number } {
    const k = 0.7071
    switch (d) {
      case JoyDirection.center: return { x: 0, y: 0 }
      case JoyDirection.up: return { x: 0, y: 1 }
      case JoyDirection.upRight: return { x: k, y: k }
      case JoyDirection.right: return { x: 1, y: 0 }
      case JoyDirection.downRight: return { x: k, y: -k }
      case JoyDirection.down: return { x: 0, y: -1 }
      case JoyDirection.downLeft: return { x: -k, y: -k }
      case JoyDirection.left: return { x: -1, y: 0 }
      case JoyDirection.upLeft: return { x: -k, y: k }
    }
  }
}

/** The joystick's harmonic personality. */
export enum JoystickMap { standard, extended, chromatic, borrow, classic }

// Legends indexed by JoyDirection - 1 (up ... upLeft).
const legends: Record<JoystickMap, string[]> = {
  [JoystickMap.standard]: ['maj/min', '7', 'maj7/m7', '9', 'sus4', '6/sus2', 'dim', 'aug'],
  [JoystickMap.extended]: ['m7b5', '9', '7sus4', 'add11', 'add9', '7#9', 'm11', 'maj9'],
  [JoystickMap.chromatic]: ['+1', 'mMaj7', 'maj13', '7b9', '-1', '7alt', '6/9', 'm7b5'],
  [JoystickMap.borrow]: ['V7/', 'par.', 'b maj', 'dim7', 'tri', 'bVII7', 'maj', 'V7sus'],
  [JoystickMap.classic]: ['maj/min', '7', 'maj7/m7', '9*', 'sus4', 'sus2', 'dim', 'aug'],
}

export namespace JoystickMap {
  export const allCases: JoystickMap[] = [
    JoystickMap.standard, JoystickMap.extended, JoystickMap.chromatic, JoystickMap.borrow, JoystickMap.classic,
  ]

  export function displayName(m: JoystickMap): string {
    return ['DEFAULT', 'EXTENDED', 'CHROMATIC', 'BORROW', 'CLASSIC'][m]
  }

  /** Short labels for each direction, used by the on-screen joystick legend. */
  export function legend(m: JoystickMap, dir: JoyDirection): string {
    if (dir === JoyDirection.center) return ''
    return legends[m][dir - 1]
  }
}
