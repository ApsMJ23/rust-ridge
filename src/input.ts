// Input abstraction: game code reads Controls, never key codes.
// Gamepad and touch plug in here later without touching car code.
export interface Controls {
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // -1 (right) .. 1 (left)
  handbrake: boolean
  shiftUp: boolean
  shiftDown: boolean
  toggleGearbox: boolean
}

const keys = new Set<string>()

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    // macOS swallows keyup for keys held under Cmd — drop everything rather
    // than leave a steer key stuck; also keeps Cmd/Alt+Arrow navigation working
    keys.clear()
    return
  }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
  keys.add(e.code)
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('blur', () => keys.clear())

// reused every frame — no per-frame allocation
const controls: Controls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
  toggleGearbox: false,
}

const DEADZONE = 0.15
let gpBlocked = false
let prevShiftUp = false
let prevShiftDown = false
let prevGearbox = false
let prevGpShiftUp = false
let prevGpShiftDown = false
let prevGpGearbox = false

export function readControls(): Controls {
  controls.throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0
  controls.brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0
  controls.steer =
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
  controls.handbrake = keys.has('Space')
  const keyShiftUp = keys.has('KeyE')
  const keyShiftDown = keys.has('KeyQ')
  const keyGearbox = keys.has('KeyM')
  controls.shiftUp = keyShiftUp && !prevShiftUp
  controls.shiftDown = keyShiftDown && !prevShiftDown
  controls.toggleGearbox = keyGearbox && !prevGearbox
  prevShiftUp = keyShiftUp
  prevShiftDown = keyShiftDown
  prevGearbox = keyGearbox

  // gamepad overlays keyboard: left stick steers (analog!), triggers pedal,
  // A/Cross is the handbrake, bumpers shift, Y/Triangle toggles gearbox mode
  let gp: Gamepad | null | undefined
  if (!gpBlocked) {
    try {
      gp = navigator.getGamepads?.()[0]
    } catch {
      gpBlocked = true // permissions-policy denial (e.g. cross-origin iframe)
    }
  }
  if (gp) {
    const ax = gp.axes[0] ?? 0
    if (Math.abs(ax) > DEADZONE) {
      controls.steer = -Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE))
    }
    const throttle = gp.buttons[7]?.value ?? 0
    const brake = gp.buttons[6]?.value ?? 0
    if (throttle > 0.02) controls.throttle = Math.max(controls.throttle, throttle)
    if (brake > 0.02) controls.brake = Math.max(controls.brake, brake)
    if (gp.buttons[0]?.pressed) controls.handbrake = true
    const gpShiftDown = !!gp.buttons[4]?.pressed
    const gpShiftUp = !!gp.buttons[5]?.pressed
    const gpGearbox = !!gp.buttons[3]?.pressed
    controls.shiftDown ||= gpShiftDown && !prevGpShiftDown
    controls.shiftUp ||= gpShiftUp && !prevGpShiftUp
    controls.toggleGearbox ||= gpGearbox && !prevGpGearbox
    prevGpShiftDown = gpShiftDown
    prevGpShiftUp = gpShiftUp
    prevGpGearbox = gpGearbox
  } else {
    prevGpShiftDown = false
    prevGpShiftUp = false
    prevGpGearbox = false
  }
  return controls
}
