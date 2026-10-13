import * as THREE from 'three'
import type { Obstacle } from './car.ts'
import { carChrome, carDarkTrim, carPaint, carRubber, type WorldMaterials } from './materials.ts'

// The whole game now: a straight, endless multi-lane highway. Forward is -z, so
// the player drives toward more-negative z. Traffic all flows the same way at a
// crawl compared to the Ferrari — you weave through and overtake, and clipping
// one drains the damage bar. Nothing here turns; it's a river of cars you thread.

export const LANES = 5
export const LANE_W = 3.6
export const ROAD_HALF = (LANES * LANE_W) / 2 // 9m — beyond this you're on the dirt shoulder
export const laneX = (i: number) => (i - (LANES - 1) / 2) * LANE_W // -7.2 .. 7.2

const PALETTE = ['#d9553f', '#4f7fb5', '#c9a23c', '#5c8d5f', '#8a68a8', '#b8b0a4', '#2f333a', '#e0e0e0']

// recycle geometry: a car that falls this far behind the player respawns this
// far ahead. Keeps ~all cars in a band around the player.
const BEHIND = 70
const AHEAD_MIN = 150
const AHEAD_SPAN = 220
const CRUISE_MIN = 10 // m/s (~36 km/h)
const CRUISE_SPAN = 22 // up to ~32 m/s (~115 km/h); player tops ~50 m/s
// car-following + lane-changing so it reads as live traffic, not fixed columns
const T_ACCEL = 4 // gentle m/s²
const T_BRAKE = 11 // m/s²
const FOLLOW_GAP = 24 // ease off the throttle inside this gap to the car ahead (m)
const LANE_EASE = 2.6 // how fast a car slides into its target lane (1/s)
const LANE_CLEAR = 17 // block a lane change if another car is within this z-window
const LANE_CD_MIN = 2.5 // min seconds between a car's lane changes

const clamp = THREE.MathUtils.clamp

interface TCar {
  lane: number // target lane index; x eases toward it
  x: number
  px: number // previous x for render interpolation (smooth lane changes)
  z: number
  pz: number
  speed: number // actual
  cruise: number // desired cruising speed
  yaw: number // slight heading offset while changing lanes
  seed: number
  laneCd: number // seconds until this car may change lanes again
}

const _base = new THREE.Matrix4()
const _part = new THREE.Matrix4()
const local = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)

export class HighwayTraffic {
  readonly group = new THREE.Group()
  readonly obstacles: Obstacle[] = []
  private readonly cars: TCar[] = []
  private readonly parts: { mesh: THREE.InstancedMesh; locals: THREE.Matrix4[] }[] = []
  private readonly count: number

  constructor(count = 20) {
    this.count = count
    for (let i = 0; i < count; i++) {
      const car: TCar = { lane: 0, x: 0, px: 0, z: 0, pz: 0, speed: 0, cruise: 0, yaw: 0, seed: (i * 2654435761 + 1) >>> 0, laneCd: 0 }
      this.cars.push(car)
      this.obstacles.push({ x: 0, z: 0, hw: 0.95, hd: 2.05 })
    }
    this.buildMeshes(count)
    this.reset(0)
  }

  private rand(c: TCar): number {
    c.seed = (c.seed * 1664525 + 1013904223) >>> 0
    return c.seed / 4294967296
  }

  // (re)spawn the whole field spread out ahead of the player — used at start and
  // on every crash restart so a run always begins with a clear stretch.
  reset(playerZ: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      c.lane = i % LANES // seed coverage across lanes; they diverge as they drive
      c.x = laneX(c.lane)
      c.px = c.x
      // staggered base spread + jitter so no two lanes line up in a grid
      c.z = playerZ - 40 - (i / this.count) * (AHEAD_MIN + AHEAD_SPAN) - this.rand(c) * 45
      c.pz = c.z
      c.cruise = CRUISE_MIN + this.rand(c) * CRUISE_SPAN
      c.speed = c.cruise
      c.yaw = 0
      c.laneCd = this.rand(c) * LANE_CD_MIN
      this.syncObstacle(i)
    }
  }

  private syncObstacle(i: number) {
    const c = this.cars[i]
    this.obstacles[i].x = c.x
    this.obstacles[i].z = c.z
  }

  // drop a car back in ahead of the player in whichever lane has the most room
  private recycle(c: TCar, playerZ: number) {
    const z = playerZ - AHEAD_MIN - this.rand(c) * AHEAD_SPAN
    // pick the lane whose nearest car to `z` is furthest — avoids stacking
    let bestLane = Math.floor(this.rand(c) * LANES)
    let bestGap = -1
    for (let l = 0; l < LANES; l++) {
      let gap = Infinity
      for (const o of this.cars) {
        if (o === c || o.lane !== l) continue
        gap = Math.min(gap, Math.abs(o.z - z))
      }
      if (gap > bestGap) {
        bestGap = gap
        bestLane = l
      }
    }
    c.lane = bestLane
    c.x = laneX(bestLane)
    c.px = c.x
    c.z = z
    c.pz = z
    c.cruise = CRUISE_MIN + this.rand(c) * CRUISE_SPAN
    c.speed = c.cruise
    c.yaw = 0
    c.laneCd = this.rand(c) * LANE_CD_MIN
  }

  // nearest car ahead (smaller z) in `lane`, and how fast it's going
  private leadAhead(c: TCar, lane: number): { gap: number; speed: number } {
    let gap = Infinity
    let speed = CRUISE_MIN + CRUISE_SPAN
    for (const o of this.cars) {
      if (o === c || o.lane !== lane) continue
      const d = c.z - o.z // >0 → o is ahead
      if (d > 0 && d < gap) {
        gap = d
        speed = o.speed
      }
    }
    return { gap, speed }
  }

  // is `lane` free of any car within a safety window beside this one?
  private laneClear(c: TCar, lane: number): boolean {
    for (const o of this.cars) {
      if (o === c || o.lane !== lane) continue
      if (Math.abs(o.z - c.z) < LANE_CLEAR) return false
    }
    return true
  }

  step(dt: number, playerZ: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      c.pz = c.z
      c.px = c.x

      // follow the car ahead: bleed speed toward it inside the gap so packs form
      const lead = this.leadAhead(c, c.lane)
      let target = c.cruise
      if (lead.gap < FOLLOW_GAP) target = Math.min(c.cruise, lead.speed * clamp(lead.gap / FOLLOW_GAP, 0.3, 1))

      // lane changes: overtake when stuck behind a slower car, plus rare idle drift
      c.laneCd -= dt
      if (c.laneCd <= 0) {
        const stuck = lead.gap < FOLLOW_GAP * 1.1 && c.cruise > lead.speed + 1.5
        if (stuck) {
          let best = c.lane
          let bestGap = lead.gap
          for (const nl of [c.lane - 1, c.lane + 1]) {
            if (nl < 0 || nl >= LANES || !this.laneClear(c, nl)) continue
            const g = this.leadAhead(c, nl).gap
            if (g > bestGap + 6) {
              bestGap = g
              best = nl
            }
          }
          if (best !== c.lane) {
            c.lane = best
            c.laneCd = LANE_CD_MIN + this.rand(c) * 2.5
          } else {
            c.laneCd = 0.6 // boxed in — recheck shortly
          }
        } else if (this.rand(c) < 0.2 * dt) {
          const nl = c.lane + (this.rand(c) < 0.5 ? -1 : 1)
          if (nl >= 0 && nl < LANES && this.laneClear(c, nl)) {
            c.lane = nl
            c.laneCd = LANE_CD_MIN + this.rand(c) * 2.5
          }
        }
      }

      // slide toward the target lane; a slight nose-yaw sells the manoeuvre
      c.x += (laneX(c.lane) - c.x) * Math.min(1, LANE_EASE * dt)
      const lateralV = (c.x - c.px) / dt
      c.yaw += (clamp(-lateralV / Math.max(8, c.speed), -0.09, 0.09) - c.yaw) * Math.min(1, 8 * dt)

      // accel/brake toward the target speed
      c.speed += clamp(target - c.speed, -T_BRAKE * dt, T_ACCEL * dt)
      if (c.speed < 0) c.speed = 0

      c.z -= c.speed * dt // forward is -z
      if (c.z > playerZ + BEHIND) this.recycle(c, playerZ)
      this.syncObstacle(i)
    }
  }

  private buildMeshes(count: number) {
    const dark = carDarkTrim()
    const rubber = carRubber()
    const chrome = carChrome()
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#6a90a8',
      metalness: 0.2,
      roughness: 0.08,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 1.2,
    })
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, locals: THREE.Matrix4[]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count * locals.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false // instances span the whole road; box is unreliable
      this.group.add(mesh)
      this.parts.push({ mesh, locals })
      return mesh
    }

    const bodyMat = carPaint('#ffffff')
    const bodies = add(new THREE.BoxGeometry(1.85, 0.55, 4.1), bodyMat, [local(0, 0.58, 0)])
    for (let i = 0; i < count; i++) bodies.setColorAt(i, new THREE.Color(PALETTE[i % PALETTE.length]))
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true

    add(new THREE.BoxGeometry(1.55, 0.48, 1.9), dark, [local(0, 1.05, 0.25)]) // cabin
    add(new THREE.BoxGeometry(1.4, 0.35, 1.5), glass, [local(0, 1.12, 0.2)]) // windows
    const wheels = [local(-0.78, 0.34, -1.3), local(0.78, 0.34, -1.3), local(-0.78, 0.34, 1.3), local(0.78, 0.34, 1.3)]
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14)
    wheelGeo.rotateZ(Math.PI / 2)
    add(wheelGeo, rubber, wheels)
    const rimGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10)
    rimGeo.rotateZ(Math.PI / 2)
    add(rimGeo, chrome, wheels)
    // taillights face +z (toward the chasing player) — always lit
    add(
      new THREE.BoxGeometry(1.3, 0.14, 0.05),
      new THREE.MeshStandardMaterial({ color: '#e03a2a', emissive: '#ff1608', emissiveIntensity: 1.6, roughness: 0.35 }),
      [local(0, 0.58, 2.06)],
    )
    // headlights face -z
    add(
      new THREE.BoxGeometry(1.3, 0.12, 0.05),
      new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe8a0', emissiveIntensity: 1.2, roughness: 0.3 }),
      [local(0, 0.58, -2.06)],
    )
  }

  render(alpha: number) {
    for (let i = 0; i < this.count; i++) {
      const c = this.cars[i]
      const z = c.pz + (c.z - c.pz) * alpha
      const x = c.px + (c.x - c.px) * alpha
      _base.makeRotationY(c.yaw)
      _base.setPosition(x, 0, z)
      for (let pi = 0; pi < this.parts.length; pi++) {
        const part = this.parts[pi]
        for (let l = 0; l < part.locals.length; l++) {
          _part.multiplyMatrices(_base, part.locals[l])
          part.mesh.setMatrixAt(i * part.locals.length + l, _part)
        }
      }
    }
    for (const part of this.parts) part.mesh.instanceMatrix.needsUpdate = true
  }
}

// ---- the road surface ----
// Real PBR asphalt + grass + gravel verge + metal guardrails, all in one group
// that snaps to PERIOD each frame: every texture tile size divides PERIOD, so the
// whole world scrolls seamlessly and endlessly with no per-frame offset math.
const PERIOD = 8 // snap step (m); all tile sizes below divide it → seamless scroll
const ROAD_LEN = 1400
const ROAD_W = LANES * LANE_W + 2 // a touch of shoulder inside the edge lines
const VERGE_W = ROAD_W + 18 // gravel shoulder flanking the asphalt

// clone a loaded PBR material and re-tile its maps for a new plane size — the
// world materials ship baked to city-block sizes, wrong scale for a 1.4km road
function retile(src: THREE.MeshStandardMaterial, rx: number, ry: number): THREE.MeshStandardMaterial {
  const m = src.clone()
  for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
    const t = m[key]
    if (!t) continue
    const c = t.clone()
    c.wrapS = c.wrapT = THREE.RepeatWrapping
    c.repeat.set(rx, ry)
    c.needsUpdate = true
    m[key] = c
  }
  return m
}

export function buildRoad(world: WorldMaterials) {
  const group = new THREE.Group()
  const flat = (mesh: THREE.Mesh, y: number) => {
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  // grass out to the horizon (4m tiles → 8/4 = 2, divides PERIOD)
  flat(new THREE.Mesh(new THREE.PlaneGeometry(4000, ROAD_LEN), retile(world.grass, 4000 / 4, ROAD_LEN / 4)), 0)
  // gravel/dirt verge (2m tiles)
  flat(new THREE.Mesh(new THREE.PlaneGeometry(VERGE_W, ROAD_LEN), retile(world.ground, VERGE_W / 2, ROAD_LEN / 2)), 0.012)
  // asphalt (2m tiles → realistic grain)
  flat(new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), retile(world.asphaltA, ROAD_W / 2, ROAD_LEN / 2)), 0.024)

  // lane paint: worn matte white, polygon-offset above the asphalt so it never
  // z-fights and never blooms (no emissive, sub-white value)
  const paint = new THREE.MeshStandardMaterial({
    color: '#9c9a8c', // worn, sub-white so a sunlit dash never crosses the bloom threshold
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  // solid edge lines
  for (const edge of [-ROAD_HALF, ROAD_HALF]) {
    const line = flat(new THREE.Mesh(new THREE.PlaneGeometry(0.18, ROAD_LEN), paint), 0.026)
    line.position.x = edge
    line.receiveShadow = false
  }
  // dashed lane separators (3m dash every PERIOD), instanced
  const dashN = Math.floor(ROAD_LEN / PERIOD)
  const seps = LANES - 1
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 3), paint, dashN * seps)
  const o = new THREE.Object3D()
  o.rotation.x = -Math.PI / 2
  let di = 0
  for (let b = 1; b < LANES; b++) {
    const x = laneX(b) - LANE_W / 2
    for (let s = 0; s < dashN; s++) {
      o.position.set(x, 0.026, -ROAD_LEN / 2 + s * PERIOD)
      o.updateMatrix()
      dashes.setMatrixAt(di++, o.matrix)
    }
  }
  dashes.frustumCulled = false
  dashes.receiveShadow = true
  group.add(dashes)

  // steel W-beam guardrail: a continuous beam on each side + posts every PERIOD
  const rail = world.metal
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, ROAD_LEN), rail)
    beam.position.set(side * (ROAD_HALF + 1), 0.62, 0)
    beam.castShadow = true
    group.add(beam)
  }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), rail, 2 * dashN)
  let pi = 0
  for (let s = 0; s < dashN; s++) {
    const z = -ROAD_LEN / 2 + s * PERIOD
    for (const side of [-1, 1]) {
      o.rotation.x = 0
      o.position.set(side * (ROAD_HALF + 1), 0.45, z)
      o.updateMatrix()
      posts.setMatrixAt(pi++, o.matrix)
    }
  }
  posts.frustumCulled = false
  posts.castShadow = true
  group.add(posts)

  const snap = (z: number) => Math.round(z / PERIOD) * PERIOD
  return {
    group,
    recenter(carZ: number) {
      group.position.z = snap(carZ)
    },
  }
}
