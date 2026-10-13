import { TUNING } from './tuning.ts'

// One car: the Ferrari. Everything else was stripped when the game became a
// highway survival run. A CarDef is a model + a handling preset over the shared
// controller — kept as a struct so a second car is still just data if wanted.
export interface CarDef {
  id: string
  name: string
  blurb: string
  model: string
  preset: Partial<typeof TUNING>
  gears: number // evenly spaced across this car's own maxSpeed — see Car.setGears
  engine: string // this car's recorded engine loop (CC0) — see audio.setEngineLoop
  voice: { pitch: number; growl: number } // engine tone: pitch = loop base speed, growl = brightness
  recolor?: Record<string, string> // material name -> paint, see Car.loadModel
  glb?: boolean // load the real .glb, not a procedural shell — for photoreal models
  modelYaw?: number // extra Y rotation (rad) to face our forward (-z); glbs vary, default Math.PI
  spinWheels?: boolean // false = leave wheels static (for rigs we can't roll cleanly)
  wheelAxis?: 'x' | 'y' | 'z' // local roll axis of the wheel pivots, default 'x'
  wheelNodes?: string[] // explicit wheel-pivot node names when they aren't called "wheel"
}

// the neutral handling baseline, captured before any preset or panel edits
const BASE = (({
  accel,
  brake,
  maxSpeed,
  maxReverse,
  rollDecel,
  drag,
  steerRate,
  steerFalloff,
  brakeSteer,
  handbrakeSteer,
  grip,
  driftGrip,
  brakeGrip,
  slideDrag,
  shiftCut,
  engineBraking,
  manualLug,
  manualOverrevDrag,
}) => ({
  accel,
  brake,
  maxSpeed,
  maxReverse,
  rollDecel,
  drag,
  steerRate,
  steerFalloff,
  brakeSteer,
  handbrakeSteer,
  grip,
  driftGrip,
  brakeGrip,
  slideDrag,
  shiftCut,
  engineBraking,
  manualLug,
  manualOverrevDrag,
}))(TUNING)

export const FERRARI: CarDef = {
  id: 'ferrari',
  name: 'FERRARI 458 ITALIA',
  blurb: 'the real deal - a licensed supercar model, every panel photoreal',
  model: './ferrari.glb',
  glb: true, // photoreal glTF, not a procedural shell
  modelYaw: 0, // this glb already faces -z; skip the default Kenney flip
  preset: {
    accel: 18, // strong pull
    brake: 34,
    maxSpeed: 68, // ~245 km/h
    grip: 14, // planted rear — holds a line, gentle controllable slides not arcade drift
    driftGrip: 2.8,
    steerRate: 2.1, // slightly calmer lock; the input ramp does the smoothing
    steerFalloff: 0.02, // more stable at speed
    brakeSteer: 0.2, // less brake-to-rotate arcade turn-in
    slideDrag: 0.01,
    shiftCut: 0.07,
  },
  gears: 5, // fewer, longer gears — gradual shifts, not a blitz
  engine: './ferrari_engine.wav',
  voice: { pitch: 1.55, growl: 1.4 }, // flat-plane V8 scream
  recolor: { Body_Color: '#d40000' }, // rosso corsa — material name from the glb
}

export const AVENTADOR: CarDef = {
  id: 'aventador',
  name: 'LAMBORGHINI AVENTADOR',
  blurb: 'naturally-aspirated V12 — the loudest thing on the highway',
  model: './aventador/aventador.gltf', // multi-file glTF; GLTFLoader resolves the .bin + textures
  glb: true,
  modelYaw: -Math.PI / 2, // native model faces -x (sideways); yaw it to our -z forward
  wheelAxis: 'z', // model faces -x natively, so the wheel axle is the local Z axis
  preset: {
    accel: 20,
    brake: 35,
    maxSpeed: 74, // top dog
    grip: 15,
    driftGrip: 2.6,
    steerRate: 2.05,
    steerFalloff: 0.021,
    brakeSteer: 0.2,
    slideDrag: 0.01,
    shiftCut: 0.06,
  },
  gears: 5,
  engine: './aventador_engine.wav',
  voice: { pitch: 1.2, growl: 1.65 }, // V12 — deeper and angrier than the Ferrari
}

export const URUS: CarDef = {
  id: 'urus',
  name: 'LAMBORGHINI URUS',
  blurb: 'a 2-tonne super-SUV that hits like a supercar',
  model: './urus/scene.gltf',
  glb: true,
  modelYaw: Math.PI, // native model faces +z; flip to our -z forward
  wheelNodes: ['FL', 'FR', 'RL', 'RR'], // real pivots (they don't contain "wheel"); axle is local X
  preset: {
    accel: 15, // heavy SUV — slowest to wind up through the gears
    brake: 33,
    maxSpeed: 62,
    grip: 13, // more mass, a touch more understeer
    driftGrip: 2.5,
    steerRate: 2.0,
    steerFalloff: 0.022,
    brakeSteer: 0.18,
    slideDrag: 0.012,
    shiftCut: 0.08,
  },
  gears: 6,
  engine: './urus_engine.wav',
  voice: { pitch: 1.05, growl: 1.4 }, // twin-turbo V8 rumble
}

// the garage — G cycles through these in-game
export const CARS: CarDef[] = [FERRARI, AVENTADOR, URUS]

// resets handling to the baseline first so presets never stack
export function applyCarPreset(def: CarDef) {
  Object.assign(TUNING, BASE, def.preset)
}
