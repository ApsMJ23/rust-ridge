import * as THREE from 'three'
import type { Obstacle } from './car.ts'
import { honk } from './audio.ts'
import { toonMat } from './look.ts'
import { CITY_AVENUES, CITY_BOUNDS, CITY_STREETS } from './town.ts'

// Grid traffic: cars hold the right-hand lane of an avenue or street, turn at
// random intersections, brake for whoever is ahead, and honk when the player
// blocks them. Deterministic per-car LCG, fixed-step like everything else.
// ponytail: no cross-traffic yielding at intersections — cars can overlap for
// a moment while crossing; add a simple intersection lock if it ever reads bad.

const COUNT = 26
const LANE = 4 // right-hand offset from road centerline
const CRUISE_MIN = 7
const CRUISE_SPAN = 4
const ACCEL = 7
const BRAKE = 16
const AHEAD = 10 // braking lookahead, m
const PALETTE = ['#d9553f', '#4f7fb5', '#c9a23c', '#5c8d5f', '#8a68a8', '#b8b0a4', '#3f4854']

// dir: 0 +x, 1 -x (on streets), 2 +z, 3 -z (on avenues)
const DX = [1, -1, 0, 0]
const DZ = [0, 0, 1, -1]
// heading whose forward (-sin h, -cos h) matches each dir
const HEADING = [-Math.PI / 2, Math.PI / 2, Math.PI, 0]
// right-hand lane offset applied to the perpendicular coordinate
const LANE_SIGN = [1, -1, -1, 1] // dir 0: z+4 · 1: z-4 · 2: x-4 · 3: x+4

const AVENUES = [...CITY_AVENUES].sort((a, b) => a - b)
const STREETS = [...CITY_STREETS].sort((a, b) => a - b)

interface TCar {
  x: number
  z: number
  px: number
  pz: number
  dir: number
  road: number // the coordinate of the road being driven (x of avenue / z of street)
  speed: number
  cruise: number
  vh: number // smoothed visual heading
  seed: number
  blockedFor: number
  honkCd: number
}

const _car = new THREE.Object3D()
const _part = new THREE.Matrix4()
const _carM = new THREE.Matrix4()

function localMatrix(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z)
}

export class Traffic {
  readonly group = new THREE.Group()
  readonly obstacles: Obstacle[] = []
  private readonly cars: TCar[] = []
  private readonly parts: { mesh: THREE.InstancedMesh; locals: THREE.Matrix4[] }[] = []

  constructor(count = COUNT) {
    for (let i = 0; i < count; i++) {
      const seed = (i * 2654435761) >>> 0
      const car: TCar = {
        x: 0,
        z: 0,
        px: 0,
        pz: 0,
        dir: i % 4,
        road: 0,
        speed: 0,
        cruise: CRUISE_MIN + (i % 5) * (CRUISE_SPAN / 4),
        vh: 0,
        seed,
        blockedFor: 0,
        honkCd: 0,
      }
      // spread the fleet over the grid: even cars on avenues, odd on streets
      if (car.dir >= 2) {
        car.road = AVENUES[(i * 3) % AVENUES.length]
        car.x = car.road + LANE * LANE_SIGN[car.dir]
        car.z = CITY_BOUNDS.minZ + 30 + ((i * 97) % (CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ - 60))
      } else {
        car.road = STREETS[(i * 5) % STREETS.length]
        car.z = car.road + LANE * LANE_SIGN[car.dir]
        car.x = CITY_BOUNDS.minX + 30 + ((i * 131) % (CITY_BOUNDS.maxX - CITY_BOUNDS.minX - 60))
      }
      car.px = car.x
      car.pz = car.z
      car.vh = HEADING[car.dir]
      this.cars.push(car)
      this.obstacles.push({ x: car.x, z: car.z, hw: 1, hd: 1 })
    }

    this.buildMeshes(count)
  }

  private buildMeshes(count: number) {
    const dark = toonMat('#2b2f38')
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, locals: THREE.Matrix4[]) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count * locals.length)
      mesh.castShadow = true
      this.group.add(mesh)
      this.parts.push({ mesh, locals })
      return mesh
    }

    const bodies = add(new THREE.BoxGeometry(1.85, 0.75, 4.1), toonMat('#ffffff'), [
      localMatrix(0, 0.62, 0),
    ])
    for (let i = 0; i < count; i++) {
      bodies.setColorAt(i, new THREE.Color(PALETTE[i % PALETTE.length]))
    }
    add(new THREE.BoxGeometry(1.55, 0.55, 2.0), dark, [localMatrix(0, 1.15, 0.3)])
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 10)
    wheelGeo.rotateZ(Math.PI / 2)
    add(wheelGeo, dark, [
      localMatrix(-0.78, 0.34, -1.3),
      localMatrix(0.78, 0.34, -1.3),
      localMatrix(-0.78, 0.34, 1.3),
      localMatrix(0.78, 0.34, 1.3),
    ])
    add(
      new THREE.BoxGeometry(1.2, 0.14, 0.06),
      new THREE.MeshBasicMaterial({ color: '#fff3c4' }),
      [localMatrix(0, 0.62, -2.06)],
    )
    add(
      new THREE.BoxGeometry(1.2, 0.14, 0.06),
      new THREE.MeshBasicMaterial({ color: '#e03a2a' }),
      [localMatrix(0, 0.62, 2.06)],
    )
  }

  private rand(car: TCar): number {
    car.seed = (car.seed * 1664525 + 1013904223) >>> 0
    return car.seed / 4294967296
  }

  step(dt: number, playerX: number, playerZ: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      c.px = c.x
      c.pz = c.z

      // brake for anything ahead in my lane (other traffic or the player)
      let target = c.cruise
      const fx = DX[c.dir]
      const fz = DZ[c.dir]
      for (const o of this.cars) {
        if (o === c) continue
        const ax = (o.x - c.x) * fx + (o.z - c.z) * fz
        const lat = Math.abs((o.x - c.x) * fz - (o.z - c.z) * fx)
        // stop constant must exceed the 4.1m body length or queues interpenetrate
        if (ax > 0.5 && ax < AHEAD && lat < 2.5) target = Math.min(target, Math.max(0, (ax - 5) * 2))
      }
      const pAx = (playerX - c.x) * fx + (playerZ - c.z) * fz
      const pLat = Math.abs((playerX - c.x) * fz - (playerZ - c.z) * fx)
      let blockedByPlayer = false
      if (pAx > -1 && pAx < AHEAD + 1 && pLat < 2.8) {
        target = 0
        blockedByPlayer = true
      }

      c.speed += THREE.MathUtils.clamp(target - c.speed, -BRAKE * dt, ACCEL * dt)

      // an annoyed honk once the player has camped in front for a while
      c.honkCd = Math.max(0, c.honkCd - dt)
      if (blockedByPlayer && c.speed < 1) {
        c.blockedFor += dt
        if (c.blockedFor > 1.6 && c.honkCd === 0 && pLat + pAx < 14) {
          honk(0.8 + this.rand(c) * 0.12)
          c.honkCd = 3.5 + this.rand(c) * 3
          c.blockedFor = 0
        }
      } else {
        c.blockedFor = 0
      }

      this.advance(c, c.speed * dt)

      // ease into the lane of whatever road we're on now
      const lane = c.road + LANE * LANE_SIGN[c.dir]
      const k = Math.min(1, 3 * dt)
      if (c.dir < 2) c.z += (lane - c.z) * k
      else c.x += (lane - c.x) * k

      const alongX = c.dir < 2
      const obs = this.obstacles[i]
      obs.x = c.x
      obs.z = c.z
      obs.hw = alongX ? 2.05 : 0.95
      obs.hd = alongX ? 0.95 : 2.05
    }
  }

  // move along the current road, turning at whichever intersections we cross
  private advance(c: TCar, dist: number) {
    const alongX = c.dir < 2
    const pos = alongX ? c.x : c.z
    const sign = alongX ? DX[c.dir] : DZ[c.dir]
    const next = pos + dist * sign
    const crossings = alongX ? AVENUES : STREETS

    for (const p of crossings) {
      const crossed = sign > 0 ? pos < p && next >= p : pos > p && next <= p
      if (!crossed) continue
      const r = this.rand(c)
      if (r < 0.42) {
        // turn onto the crossing road; lane easing swings us into position
        const newDir = alongX ? (r < 0.21 ? 2 : 3) : r < 0.21 ? 0 : 1
        if (alongX) {
          c.x = p
          c.road = p
        } else {
          c.z = p
          c.road = p
        }
        c.dir = newDir
        return
      }
    }

    if (alongX) c.x = next
    else c.z = next

    // off the edge of the grid: wrap to the far side of the same road, and
    // snap the interpolation basis or render() sweeps a ghost across the map
    let wrapped = true
    if (c.x < CITY_BOUNDS.minX - 10) c.x = CITY_BOUNDS.maxX + 10
    else if (c.x > CITY_BOUNDS.maxX + 10) c.x = CITY_BOUNDS.minX - 10
    else if (c.z < CITY_BOUNDS.minZ - 10) c.z = CITY_BOUNDS.maxZ + 10
    else if (c.z > CITY_BOUNDS.maxZ + 10) c.z = CITY_BOUNDS.minZ - 10
    else wrapped = false
    if (wrapped) {
      c.px = c.x
      c.pz = c.z
    }
  }

  render(alpha: number, dt: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      // shortest-path smoothing so turns sweep instead of snapping
      let dh = HEADING[c.dir] - c.vh
      dh = ((dh + Math.PI) % (Math.PI * 2)) - Math.PI
      if (dh < -Math.PI) dh += Math.PI * 2
      c.vh += dh * Math.min(1, 8 * dt)

      _car.position.set(
        THREE.MathUtils.lerp(c.px, c.x, alpha),
        0,
        THREE.MathUtils.lerp(c.pz, c.z, alpha),
      )
      _car.rotation.y = c.vh
      _car.updateMatrix()
      _carM.copy(_car.matrix)

      for (const part of this.parts) {
        for (let l = 0; l < part.locals.length; l++) {
          _part.multiplyMatrices(_carM, part.locals[l])
          part.mesh.setMatrixAt(i * part.locals.length + l, _part)
        }
      }
    }
    for (const part of this.parts) part.mesh.instanceMatrix.needsUpdate = true
  }
}
