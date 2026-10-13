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
  steerSmooth: 7, // steer input ramp toward lock, 1/s — lower = heavier, sim-like turn-in
  steerReturn: 13, // faster ramp back to centre so the car tracks straight cleanly
  throttleSmooth: 8, // power-delivery ramp, 1/s — weighty launch instead of an instant snap
  steerFalloff: 0.028, // steering authority lost per m/s of speed (tighter high-speed)
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
  // weight transfer: brake loads front (more grip/steer), throttle unloads rear
  weightTransfer: 0.22,
  // surface grip multipliers (road vs dirt) applied in Car.step
  roadGrip: 1.0,
  dirtGrip: 0.72,
  camDist: 8.5,
  camHeight: 3.6,
  camLag: 5.2, // follow stiffness; higher = tighter
  camLookAhead: 4.5, // meters ahead along velocity for look target
  camBank: 0.08, // bank into turns (radians at full lateral)
  camShake: 0.55, // impact shake amplitude scale
  fovKick: 10, // extra FOV degrees at top speed; 0 disables (motion comfort)
  leanRoll: 0.022, // visual body roll per m/s of lateral slide — lean into corners
  leanPitch: 0.003, // visual body pitch per m/s² of accel — squat/dive under power/brake
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
