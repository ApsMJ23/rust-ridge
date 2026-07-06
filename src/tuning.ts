// Every handling/camera magic number lives here — never inline one elsewhere.
// lil-gui edits these live; "copy preset JSON" exports the current values.
// Each future car = a mesh + one of these presets.
export const TUNING = {
  accel: 18, // full-throttle accel, m/s²
  brake: 30, // braking decel, m/s²
  maxSpeed: 42, // m/s (~150 km/h)
  maxReverse: 8, // m/s
  rollDecel: 3, // coast decel, m/s²
  drag: 0.04, // extra coast decel per m/s of speed, 1/s
  steerRate: 2.2, // max yaw rate, rad/s
  steerFalloff: 0.02, // steering authority lost per m/s of speed
  brakeSteer: 0.28, // extra yaw authority while braking
  handbrakeSteer: 0.75, // extra yaw authority while the handbrake is held
  grip: 8, // how fast lateral slide dies, 1/s — lower = looser rear
  driftGrip: 2, // grip while the handbrake is held (space) — the drift knob
  brakeGrip: 0.35, // braking helps the tires pull sideways speed back in
  slideDrag: 0.018, // speed scrubbed by big sideways slides
  shiftCut: 0.12, // s of torque interruption on an upshift
  engineBraking: 0.15, // extra coast decel per gear below top, off-throttle
  manualLug: 0.45, // high-gear low-speed torque floor in manual mode
  manualOverrevDrag: 22, // selected gear speed limit strength in manual mode
  camDist: 9,
  camHeight: 4.2,
  camLag: 4, // follow stiffness; higher = tighter
  fovKick: 8, // extra FOV degrees at top speed; 0 disables (motion comfort)
  leanRoll: 0.012, // visual body roll per m/s of lateral slide
  leanPitch: 0.0015, // visual body pitch per m/s² of accel
}

export async function initTuningPanel() {
  // lazy import keeps lil-gui out of the main bundle and out of node (selfcheck)
  const { default: GUI } = await import('lil-gui')
  const gui = new GUI({ title: 'tuning' })
  for (const key of Object.keys(TUNING) as Array<keyof typeof TUNING>) {
    gui.add(TUNING, key).listen() // car presets rewrite these live
  }
  const preset = {
    copy: () => navigator.clipboard.writeText(JSON.stringify(TUNING, null, 2)),
  }
  gui.add(preset, 'copy').name('copy preset JSON')
  gui.close()
}
