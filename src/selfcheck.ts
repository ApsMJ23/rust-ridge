// Runtime self-check for the car controller, mission manager, and car roster:
// `npm run check` (plain node, no framework)
import { Car } from './car.ts'
import { applyCarPreset, CARS, unlockedCars } from './cars.ts'
import { MissionManager } from './mission.ts'
import type { MissionDef } from './missions.ts'
import { TUNING } from './tuning.ts'

// deliberately NOT an `asserts` predicate — literal narrowing on class
// properties would make later comparisons type errors
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`selfcheck failed: ${msg}`)
}

const car = new Car()
const dt = 1 / 60

// complete Controls baseline — spread + override per scenario
const CTL = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
  toggleGearbox: false,
}
const drive = { ...CTL, throttle: 1 }
let lastGear = car.gear
assert(lastGear === 1, 'starts in first gear')
for (let i = 0; i < 600; i++) {
  car.step(dt, drive) // 10s full throttle, straight
  assert(car.gear >= lastGear, 'gears only upshift while accelerating')
  lastGear = car.gear
}
assert(car.gear === 5 && car.rpm > 0.95, 'top speed is fifth gear near redline')
assert(car.vF > 40, 'reaches near top speed')
assert(car.vF <= 42.0001, 'clamped to maxSpeed')
assert(Math.abs(car.x) < 1e-6 && car.z < -100, 'moves straight forward along -z')
assert(car.vL === 0, 'no lateral slide when driving straight')

drive.steer = 1
for (let i = 0; i < 120; i++) car.step(dt, drive) // 2s steering left
assert(car.heading > 0.3, 'steering turns the car')

const coast = { ...CTL }
for (let i = 0; i < 3600; i++) car.step(dt, coast) // 60s hands off
assert(car.speed === 0, 'coasts to a complete stop')

// gearbox: a full accel-to-top / coast-to-stop round trip shifts exactly
// 8 times (4 up, 4 down) — no hunting at a boundary speed — and ends parked
// back in first gear
const cg = new Car()
const gearLog: number[] = []
for (let i = 0; i < 900; i++) {
  cg.step(dt, drive) // 15s full throttle: well past reaching top gear
  gearLog.push(cg.gear)
}
for (let i = 0; i < 1800; i++) {
  cg.step(dt, coast) // 30s coasting: comfortably enough to decelerate to a stop
  gearLog.push(cg.gear)
}
let shiftCount = 0
for (let i = 1; i < gearLog.length; i++) if (gearLog[i] !== gearLog[i - 1]) shiftCount++
assert(shiftCount === 8, `gearbox shifts exactly 8 times over a full accel/coast cycle (saw ${shiftCount})`)
assert(cg.gear === 1 && cg.speed < 0.5, 'coasting all the way down ends parked in first gear')

// engine braking: lower gears decelerate harder than higher gears when
// coasting, same starting speed — this is what makes downshifting feel like
// something instead of a cosmetic number change
const cb1 = new Car()
cb1.vz = -20 // 20 m/s forward at heading 0
cb1.gear = 1
cb1.step(dt, coast)
const decelGear1 = 20 - Math.abs(cb1.vF)

const cb5 = new Car()
cb5.vz = -20
cb5.gear = 5
cb5.step(dt, coast)
const decelGear5 = 20 - Math.abs(cb5.vF)

assert(decelGear1 > decelGear5, 'first gear engine-brakes harder than fifth when coasting')

const brake = { ...CTL, brake: 1 }
for (let i = 0; i < 600; i++) car.step(dt, brake) // held brake from standstill
assert(car.vF >= -8.0001 && car.vF < 0, 'reverses from standstill, clamped to maxReverse')

const both = { ...CTL, throttle: 1, brake: 1 }
for (let i = 0; i < 300; i++) car.step(dt, both) // pedal conflict while reversing
assert(car.speed === 0, 'throttle+brake together brings the car to a dead stop and holds it')

// drift: handbrake+steer at speed breaks the rear loose; releasing grips back up
// (fresh controls: `drive` has steer=1 mutated into it by the steering test)
const c2 = new Car()
for (let i = 0; i < 600; i++) c2.step(dt, { ...CTL, throttle: 1 })
let maxTotal = 0
for (let i = 0; i < 60; i++) {
  c2.step(dt, { ...CTL, throttle: 1, steer: 1, handbrake: true })
  maxTotal = Math.max(maxTotal, c2.speed)
}
const slideWhileDrifting = Math.abs(c2.vL)
assert(slideWhileDrifting > 3, 'handbrake+steer breaks the rear loose')
assert(maxTotal <= 42.0001, 'drift entry never exceeds maxSpeed (no free boost)')
for (let i = 0; i < 60; i++) c2.step(dt, { ...CTL, throttle: 1, steer: 1 })
assert(Math.abs(c2.vL) < slideWhileDrifting, 'releasing the handbrake grips back up')
for (let i = 0; i < 120; i++) c2.step(dt, coast)
assert(Math.abs(c2.vL) < 0.05, 'slide dies out after straightening')

// walls: full throttle head-on into a box — stopped outside, sliding allowed, no NaN
const c3 = new Car()
const wall = [{ x: 0, z: -50, hw: 5, hd: 2 }]
for (let i = 0; i < 600; i++) c3.step(dt, { ...CTL, throttle: 1 }, wall)
assert(c3.z >= -46.91, 'car pushed out of the wall, no tunneling')
assert(Number.isFinite(c3.x) && Number.isFinite(c3.vF) && Number.isFinite(c3.vL), 'collision math stays finite')
assert(Math.abs(c3.vF) < 0.5, 'head-on contact zeroes forward speed')

// mission manager: free roam -> marker starts a run -> objectives -> result
const DEFS: MissionDef[] = [
  {
    id: 'a', title: 'A', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 5,
    start: { x: 0, z: 0, heading: 0 },
    objective: { type: 'checkpoints', route: [{ x: 0, z: -10 }, { x: 0, z: -20 }] },
  },
  {
    id: 'b', title: 'B', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 5,
    start: { x: 50, z: 0, heading: 0 },
    objective: { type: 'collect', items: [{ x: 60, z: 0 }, { x: 70, z: 0 }], finish: { x: 80, z: 0 } },
  },
  {
    // marker 2m from mission a's final checkpoint — the re-arm trap scenario
    id: 'c', title: 'C', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 5,
    start: { x: 0, z: -22, heading: 0 },
    objective: { type: 'checkpoints', route: [{ x: 0, z: -40 }] },
  },
]
const mm = new MissionManager(DEFS, {})
assert(mm.state === 'idle', 'manager starts in free roam')
mm.update(1, 100, 100)
assert(mm.state === 'idle' && mm.elapsed === 0, 'far from markers nothing starts or ticks')
mm.update(dt, 0, 0)
assert(mm.state === 'running' && mm.active?.id === 'a', 'driving into a marker starts its mission')
mm.update(dt, 0, -10)
assert(mm.index === 1, 'checkpoint collected')
mm.update(dt, 0, -20)
assert(mm.state === 'won' && mm.lastWinWasFirst && mm.completed['a'] !== undefined, 'checkpoint run won and best recorded')
// the win spot sits inside mission c's start radius — linger out while parked there
for (let i = 0; i < 400; i++) mm.update(dt, 0, -20)
assert(mm.state === 'idle' && mm.active === null, 'result screen returns to free roam')
assert(mm.retry() === null, 'nothing to retry in free roam')
mm.update(dt, 0, -20)
mm.update(dt, 0, -20)
assert(mm.state === 'idle', 'parked on a marker after a result does not auto-start it')
mm.update(dt, 100, 100) // leave every marker radius — re-arms the scan
mm.update(dt, 0, -22)
assert(mm.state === 'running' && mm.active?.id === 'c', 're-entering a marker starts its mission')
mm.update(dt, 0, -40)
assert(mm.state === 'won', 'mission c won')
for (let i = 0; i < 400; i++) mm.update(dt, 100, 100) // linger out away from markers
mm.update(dt, 50, 0)
assert(mm.state === 'running' && mm.active?.id === 'b', 'second mission starts from its marker')
mm.update(dt, 70, 0)
assert(mm.collected === 1, 'items collect in any order')
mm.update(dt, 80, 0)
assert(mm.state === 'running', 'finish ring is inert until every item is collected')
mm.update(dt, 60, 0)
mm.update(dt, 80, 0)
assert(mm.state === 'won', 'finish ring wins once all items are collected')
const pose = mm.retry()
assert(pose !== null && pose.x === 50 && mm.state === 'running' && mm.collected === 0, 'retry restarts the active mission at its marker')
for (let i = 0; i < 360; i++) mm.update(dt, 100, 100) // 6s far from everything
assert(mm.state === 'lost' && mm.timeLeft === 0, 'timeout loses the run')

// race: first across the last ring settles it, both ways
const RACE: MissionDef = {
  id: 'r', title: 'R', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 60,
  start: { x: 0, z: 0, heading: 0 },
  objective: { type: 'race', rivalSpeed: 10, route: [{ x: 0, z: -60 }, { x: 0, z: -120 }] },
}
let mr = new MissionManager([RACE], {})
mr.update(dt, 0, 0)
assert(mr.state === 'running', 'race starts from its marker')
mr.update(dt, 0, -60)
assert(mr.index === 1, 'race ring collected')
mr.update(dt, 0, -120)
assert(mr.state === 'won', 'player finishing first wins the race')
mr = new MissionManager([RACE], {})
mr.update(dt, 0, 0)
for (let i = 0; i < 3600 && mr.state === 'running'; i++) mr.update(dt, 100, 100)
assert(mr.state === 'lost' && mr.timeLeft > 0, 'rival finishing first loses the race before the clock')
assert(mr.rivalIndex === 2, 'rival actually drove the whole route')

// escape: chasers hunt on the road grid — three contacts lose, the finish wins
const ESC: MissionDef = {
  id: 'e', title: 'E', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 60,
  start: { x: 0, z: -10, heading: 0 },
  objective: { type: 'escape', finish: { x: 0, z: -190 }, chaserSpeed: 60, chasers: [{ x: 0, z: 110 }] },
}
let esc = new MissionManager([ESC], {})
esc.update(dt, 0, -10)
assert(esc.state === 'running' && esc.strikes === 0, 'escape starts clean')
for (let i = 0; i < 3600 && esc.state === 'running'; i++) esc.update(dt, 0, -10) // parked: let them catch you
assert(esc.strikes === 3 && esc.state === 'lost', 'three chaser hits lose the escape')
esc = new MissionManager([ESC], {})
esc.update(dt, 0, -10)
esc.update(dt, 0, -190)
assert(esc.state === 'won', 'reaching the finish wins the escape')

// smash: drive through every crate
const SMASH: MissionDef = {
  id: 's', title: 'S', color: '#fff', brief: '', winLine: '', loseLine: '', timeLimit: 30,
  start: { x: 0, z: 0, heading: 0 },
  objective: { type: 'smash', targets: [{ x: 10, z: 0 }, { x: 20, z: 0 }] },
}
const ms = new MissionManager([SMASH], {})
ms.update(dt, 0, 0)
assert(ms.state === 'running', 'smash starts')
ms.update(dt, 10, 0)
assert(ms.smashed === 1 && ms.state === 'running', 'crate one flattened, one to go')
ms.update(dt, 20, 0)
assert(ms.state === 'won' && ms.smashed === 2, 'all crates flattened wins')

// car roster: unlock gating + preset apply/reset (mutates TUNING — keep last)
assert(unlockedCars({}).length === 1 && unlockedCars({})[0].id === 'dusty', 'only DUSTY unlocked at the start')
assert(unlockedCars({ 'recipe-run': 30 }).some((c) => c.id === 'jackal'), 'JACKAL unlocks after the recipe run')
applyCarPreset(CARS[2])
assert(TUNING.maxSpeed === 52 && TUNING.steerFalloff === 0.017, 'vesper preset applied')
applyCarPreset(CARS[0])
assert(TUNING.maxSpeed === 34 && TUNING.steerFalloff === 0.02, 'switching cars resets un-overridden keys to baseline')

// every car has its own top speed and its own number of gears — and
// setGears actually gets each one there under full throttle
const speeds = CARS.map((c) => c.preset.maxSpeed)
assert(speeds.every((s) => typeof s === 'number'), 'every car sets its own top speed')
assert(new Set(speeds).size === CARS.length, 'every car has a distinct top speed')
// gear counts may repeat across a 9-car roster; what matters is that every
// car actually climbs to ITS OWN top gear (the loop below proves it)
for (const def of CARS) {
  applyCarPreset(def)
  const cc = new Car()
  cc.setGears(def.gears)
  for (let i = 0; i < 1800; i++) cc.step(dt, drive) // 30s full throttle — plenty for any car
  assert(cc.gear === def.gears, `${def.name} reaches its own top gear (${def.gears})`)
}

console.log('selfcheck ok')
