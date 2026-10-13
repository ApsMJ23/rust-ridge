// Runnable sanity checks for the highway build — `npm run check` (node, no GL).
// Covers the bits with real logic: the Ferrari preset, forward motion, and the
// traffic field's lane placement + recycle-ahead loop.
import { Car } from './car.ts'
import { applyCarPreset, FERRARI } from './cars.ts'
import { HighwayTraffic, LANES, laneX, ROAD_HALF } from './highway.ts'
import { TUNING } from './tuning.ts'

let failures = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    failures++
  }
}

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, toggleGearbox: false }
const laneXs = Array.from({ length: LANES }, (_, i) => laneX(i))
const onALane = (x: number) => laneXs.some((lx) => Math.abs(lx - x) < 1e-6)

// --- preset ---
applyCarPreset(FERRARI)
assert(TUNING.maxSpeed === 68, 'Ferrari preset sets highway top speed')

// --- forward motion (-z) ---
const car = new Car()
car.setGears(FERRARI.gears)
car.resetTo(0, 0, 0)
for (let i = 0; i < 40; i++) car.step(1 / 60, { ...IDLE, throttle: 1 }, [])
assert(car.z < -0.5, 'throttle drives the car forward (-z)')
assert(car.speed > 0, 'car builds speed under throttle')

// --- traffic field ---
const traffic = new HighwayTraffic(12)
assert(traffic.obstacles.length === 12, 'one obstacle per traffic car')
assert(
  traffic.obstacles.every((o) => o.z < 0),
  'field spawns entirely ahead of the player (z<0)',
)
assert(
  traffic.obstacles.every((o) => onALane(o.x) && Math.abs(o.x) <= ROAD_HALF),
  'every traffic car sits in a valid lane on the road',
)

// recycle: with the player 500m ahead, everyone falls behind and respawns ahead
const playerZ = -500
for (let i = 0; i < 20; i++) traffic.step(1 / 60, playerZ)
assert(
  traffic.obstacles.every((o) => o.z < playerZ),
  'cars left behind are recycled ahead of the player',
)
assert(
  traffic.obstacles.every((o) => Math.abs(o.x) <= ROAD_HALF),
  'cars stay within the road bounds while weaving between lanes',
)

if (failures) throw new Error(`selfcheck FAILED (${failures})`)
console.log('selfcheck ok')
