import * as THREE from 'three'
import { CITY_AVENUES, CITY_ROAD_W, CITY_STREETS } from './town.ts'

// Sidewalk pedestrians: little capsule folks strolling block perimeters. They
// can't be hit — a speeding car (or a honk) makes them dive/hop out of the way,
// Cars-movie style. Two instanced meshes for everyone.

const COUNT = 48
const SIDEWALK_INSET = 0.9 // stays clear of both the curb and the building line
const DIVE_R2 = 49 // 7m — start dodging
const HONK_R2 = 196 // 14m — hop when honked at
const GRAVITY = 12

const SHIRTS = ['#d4694f', '#5e86b8', '#c8a94e', '#6f9a68', '#9a6fb0', '#c86f92', '#e0d6c2']

type Mode = 'walk' | 'dive' | 'down' | 'rise'

interface Ped {
  // rectangle path (block perimeter) + parametric position along it
  x1: number
  z1: number
  x2: number
  z2: number
  t: number
  walkDir: 1 | -1
  speed: number
  mode: Mode
  timer: number
  x: number
  z: number
  y: number
  vx: number
  vz: number
  vy: number
  face: number
  phase: number
}

const _o = new THREE.Object3D()
// yaw first, then tip over — a downed ped lies along its own facing
_o.rotation.order = 'YXZ'

export class Peds {
  readonly group = new THREE.Group()
  private readonly peds: Ped[] = []
  private readonly bodies: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh

  constructor() {
    // pick non-park blocks round-robin, 3 peds per chosen block
    const blocks: { x1: number; z1: number; x2: number; z2: number }[] = []
    for (let ix = 0; ix < CITY_AVENUES.length - 1; ix++) {
      for (let iz = 0; iz < CITY_STREETS.length - 1; iz++) {
        if ((ix * 3 + iz * 5) % 4 !== 0) continue
        blocks.push({
          x1: CITY_AVENUES[ix] + CITY_ROAD_W / 2 + SIDEWALK_INSET,
          x2: CITY_AVENUES[ix + 1] - CITY_ROAD_W / 2 - SIDEWALK_INSET,
          z2: CITY_STREETS[iz] - CITY_ROAD_W / 2 - SIDEWALK_INSET,
          z1: CITY_STREETS[iz + 1] + CITY_ROAD_W / 2 + SIDEWALK_INSET,
        })
      }
    }
    for (let i = 0; i < COUNT; i++) {
      const b = blocks[i % blocks.length]
      const perim = 2 * (b.x2 - b.x1 + (b.z2 - b.z1))
      this.peds.push({
        x1: b.x1,
        z1: b.z1,
        x2: b.x2,
        z2: b.z2,
        t: ((i * 37) % 100) / 100 * perim,
        walkDir: i % 2 === 0 ? 1 : -1,
        speed: 1.1 + ((i * 13) % 8) / 10,
        mode: 'walk',
        timer: 0,
        x: 0,
        z: 0,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        face: 0,
        phase: (i * 0.7) % (Math.PI * 2),
      })
      this.placeOnPath(this.peds[i])
    }

    this.bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.26, 0.34, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
      COUNT,
    )
    this.bodies.castShadow = true
    this.heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#e8b48f', roughness: 0.9 }),
      COUNT,
    )
    this.heads.castShadow = true
    for (let i = 0; i < COUNT; i++) {
      this.bodies.setColorAt(i, new THREE.Color(SHIRTS[i % SHIRTS.length]))
    }
    this.group.add(this.bodies, this.heads)
  }

  // map t (distance along the perimeter loop) to a position + facing
  private placeOnPath(p: Ped) {
    const w = p.x2 - p.x1
    const d = p.z2 - p.z1
    const perim = 2 * (w + d)
    let t = ((p.t % perim) + perim) % perim
    if (t < w) {
      p.x = p.x1 + t
      p.z = p.z1
      p.face = -Math.PI / 2 // walking +x
    } else if (t < w + d) {
      p.x = p.x2
      p.z = p.z1 + (t - w)
      p.face = Math.PI // +z
    } else if (t < 2 * w + d) {
      p.x = p.x2 - (t - w - d)
      p.z = p.z2
      p.face = Math.PI / 2 // -x
    } else {
      p.x = p.x1
      p.z = p.z2 - (t - 2 * w - d)
      p.face = 0 // -z
    }
    if (p.walkDir < 0) p.face += Math.PI
  }

  step(dt: number, playerX: number, playerZ: number, playerVx: number, playerVz: number) {
    const playerSpeed = Math.hypot(playerVx, playerVz)
    for (const p of this.peds) {
      switch (p.mode) {
        case 'walk': {
          p.t += p.speed * p.walkDir * dt
          this.placeOnPath(p)
          p.phase += dt * p.speed * 4
          p.y = Math.abs(Math.sin(p.phase)) * 0.05

          // incoming! dive perpendicular to the car's path, away side
          const dx = p.x - playerX
          const dz = p.z - playerZ
          if (playerSpeed > 7 && dx * dx + dz * dz < DIVE_R2) {
            const closing = (dx * playerVx + dz * playerVz) / playerSpeed
            if (closing > 0) {
              const nx = playerVx / playerSpeed
              const nz = playerVz / playerSpeed
              // sign of d·right — the ped bails AWAY from the car's line
              const side = Math.sign(dz * nx - dx * nz) || 1
              p.mode = 'dive'
              p.vx = -nz * side * 6 + nx * 2
              p.vz = nx * side * 6 + nz * 2
              p.vy = 3.6
            }
          }
          break
        }
        case 'dive': {
          p.x += p.vx * dt
          p.z += p.vz * dt
          p.vy -= GRAVITY * dt
          p.y += p.vy * dt
          if (p.y <= 0 && p.vy < 0) {
            p.y = 0
            p.mode = 'down'
            p.timer = 0.9
          }
          break
        }
        case 'down': {
          p.timer -= dt
          if (p.timer <= 0) {
            p.mode = 'rise'
            p.timer = 0.4
          }
          break
        }
        case 'rise': {
          p.timer -= dt
          if (p.timer <= 0) {
            // rejoin the loop at the nearest perimeter point
            p.t = this.nearestT(p)
            p.mode = 'walk'
            this.placeOnPath(p)
          }
          break
        }
      }
    }
  }

  private nearestT(p: Ped): number {
    const w = p.x2 - p.x1
    const d = p.z2 - p.z1
    const cx = Math.min(Math.max(p.x, p.x1), p.x2)
    const cz = Math.min(Math.max(p.z, p.z1), p.z2)
    // distances to each edge of the rectangle → pick the closest edge
    const toZ1 = Math.abs(p.z - p.z1)
    const toZ2 = Math.abs(p.z - p.z2)
    const toX1 = Math.abs(p.x - p.x1)
    const toX2 = Math.abs(p.x - p.x2)
    const m = Math.min(toZ1, toZ2, toX1, toX2)
    if (m === toZ1) return cx - p.x1
    if (m === toX2) return w + (cz - p.z1)
    if (m === toZ2) return w + d + (p.x2 - cx) // top edge runs x2 → x1
    return 2 * w + d + (p.z2 - cz)
  }

  reactHonk(x: number, z: number) {
    for (const p of this.peds) {
      if (p.mode !== 'walk') continue
      const dx = p.x - x
      const dz = p.z - z
      if (dx * dx + dz * dz < HONK_R2) {
        p.mode = 'dive' // reuse the arc as a startled hop straight up
        p.vx = 0
        p.vz = 0
        p.vy = 2.6
      }
    }
  }

  render() {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i]
      const lying = p.mode === 'down' || (p.mode === 'rise' && p.timer > 0.2)
      _o.position.set(p.x, (lying ? 0.34 : 0.62) + p.y, p.z)
      _o.rotation.set(lying ? -Math.PI / 2 : 0, p.face, 0)
      _o.updateMatrix()
      this.bodies.setMatrixAt(i, _o.matrix)
      if (lying) {
        // head keeps its offset along the now-horizontal body axis
        _o.position.set(p.x - Math.sin(p.face) * 0.72, 0.34 + p.y, p.z - Math.cos(p.face) * 0.72)
        _o.rotation.set(0, 0, 0)
      } else {
        _o.position.y = 1.32 + p.y
        _o.rotation.set(0, 0, 0)
      }
      _o.updateMatrix()
      this.heads.setMatrixAt(i, _o.matrix)
    }
    this.bodies.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true
  }
}
