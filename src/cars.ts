import { TUNING } from './tuning.ts'

// Car roster — each car is a model + a handling preset over the shared
// controller. New car = new entry, zero code.
export interface CarDef {
  id: string
  name: string
  blurb: string
  model: string
  preset: Partial<typeof TUNING>
  gears: number // evenly spaced across this car's own maxSpeed — see Car.setGears
  voice: { pitch: number; growl: number } // engine character: osc pitch ×, filter grit ×
  recolor?: Record<string, string> // material name -> paint, see Car.loadModel
  unlockedBy?: string // mission id
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

export const CARS: CarDef[] = [
  {
    id: 'dusty',
    name: 'DUSTY',
    blurb: 'delivery pickup - grippy and forgiving',
    model: './dusty.glb',
    preset: { accel: 14, maxSpeed: 34, grip: 10, driftGrip: 3, steerRate: 2.4, brakeGrip: 0.48 },
    gears: 2, // simple 2-speed box — long, lazy shifts
    voice: { pitch: 0.9, growl: 0.9 },
  },
  {
    id: 'jackal',
    name: 'JACKAL',
    blurb: 'muscle coupe with a loose rear - the drift car',
    model: './jackal.glb',
    preset: { accel: 19, maxSpeed: 44, grip: 6.5, driftGrip: 1.5, steerRate: 2.2, handbrakeSteer: 1.0 },
    unlockedBy: 'recipe-run',
    gears: 3,
    voice: { pitch: 0.85, growl: 1.35 }, // muscle burble
  },
  {
    id: 'vesper',
    name: 'VESPER',
    blurb: 'low wedge racer - fastest thing in the city',
    model: './vesper.glb',
    preset: { accel: 24, maxSpeed: 52, grip: 9, driftGrip: 2.1, steerRate: 2.0, steerFalloff: 0.017, slideDrag: 0.012 },
    unlockedBy: 'street-race',
    gears: 4, // still the closest-ratio box of the bunch, but no longer a machine gun
    voice: { pitch: 1.3, growl: 1.2 },
  },
  {
    id: 'boxer',
    name: 'BOXER',
    blurb: 'heavy delivery van - slow, stable, hard to unsettle',
    model: './boxer.glb',
    preset: {
      accel: 12,
      brake: 34,
      maxSpeed: 31,
      grip: 12,
      driftGrip: 4.3,
      steerRate: 1.95,
      brakeSteer: 0.12,
      brakeGrip: 0.7,
      slideDrag: 0.03,
    },
    unlockedBy: 'wreck-the-lot',
    gears: 1, // one long gear — a heavy diesel drone that never shifts
    voice: { pitch: 0.62, growl: 0.75 },
  },
  {
    id: 'sprinter',
    name: 'SPRINTER',
    blurb: 'city courier coupe - quick shifts and sharp turn-in',
    model: './sprinter.glb',
    preset: {
      accel: 22,
      brake: 32,
      maxSpeed: 47,
      grip: 8.4,
      driftGrip: 2.2,
      steerRate: 2.7,
      steerFalloff: 0.019,
      shiftCut: 0.08,
      manualLug: 0.55,
    },
    unlockedBy: 'recipe-run',
    gears: 5,
    voice: { pitch: 1.15, growl: 1.1 },
  },
  {
    id: 'nova',
    name: 'NOVA',
    blurb: 'wild late-night special - fastest, twitchiest ride',
    model: './nova.glb',
    preset: {
      accel: 27,
      brake: 34,
      maxSpeed: 56,
      grip: 7.4,
      driftGrip: 1.7,
      steerRate: 2.35,
      steerFalloff: 0.015,
      handbrakeSteer: 1.15,
      shiftCut: 0.075,
      slideDrag: 0.01,
    },
    unlockedBy: 'street-race',
    gears: 6,
    voice: { pitch: 1.45, growl: 1.3 },
  },
  {
    id: 'interceptor',
    name: 'INTERCEPTOR',
    blurb: 'retired pursuit cruiser - plants itself, then pounces',
    model: './interceptor.glb',
    preset: {
      accel: 21,
      brake: 36,
      maxSpeed: 49,
      grip: 9.5,
      driftGrip: 1.9,
      steerRate: 2.5,
      steerFalloff: 0.018,
      handbrakeSteer: 1.05,
      brakeGrip: 0.55,
    },
    unlockedBy: 'recipe-run',
    gears: 4,
    voice: { pitch: 1.0, growl: 1.45 }, // big V8 under a municipal hood
  },
  {
    id: 'goliath',
    name: 'GOLIATH',
    blurb: 'decommissioned fire engine - ten tons of no thank you',
    model: './goliath.glb',
    preset: {
      accel: 10,
      brake: 30,
      maxSpeed: 28,
      maxReverse: 9,
      grip: 13,
      driftGrip: 5,
      steerRate: 1.8,
      brakeSteer: 0.1,
      slideDrag: 0.04,
    },
    unlockedBy: 'wreck-the-lot',
    gears: 2,
    voice: { pitch: 0.55, growl: 0.7 }, // diesel earthquake
  },
  {
    id: 'formula',
    name: 'FORMULA',
    blurb: 'open-wheel racing machine - the fastest thing on these streets',
    model: './formula.glb',
    preset: {
      accel: 30,
      brake: 38,
      maxSpeed: 62,
      grip: 13,
      driftGrip: 2.4,
      steerRate: 2.55,
      steerFalloff: 0.013,
      brakeSteer: 0.35,
      slideDrag: 0.008,
      shiftCut: 0.06,
    },
    unlockedBy: 'street-race',
    gears: 7,
    voice: { pitch: 1.65, growl: 1.5 }, // the scream
    recolor: { red: '#c8231a', grey: '#f2f2f4' }, // proper racing red
  },
]

export function unlockedCars(completed: Record<string, number>): CarDef[] {
  return CARS.filter((c) => !c.unlockedBy || completed[c.unlockedBy] !== undefined)
}

// resets handling to the baseline first so presets never stack
export function applyCarPreset(def: CarDef) {
  Object.assign(TUNING, BASE, def.preset)
}
