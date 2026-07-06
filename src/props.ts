import * as THREE from 'three'
import type { Obstacle } from './car.ts'
import { Dust } from './dust.ts'
import { toonMat } from './look.ts'
import { CITY_AVENUES, CITY_STREETS } from './town.ts'

// Smashable street clutter: cones, trash cans, mailboxes, fire hydrants.
// Clip one at speed and it goes flying with a hand-rolled ballistic tumble,
// then stays where it landed — GTA debris. Hydrants add a water geyser.
// One InstancedMesh per type; only airborne props rewrite their matrices.

const GRAVITY = 13
const HIT_R = 1.7
const MIN_HIT_SPEED = 2.5
const GEYSER_LIFE = 6
// resting height once knocked over, per type (roughly the lying half-extent)
const LAND_Y = [0.33, 0.42, 0.3, 0.28]

interface Prop {
  type: number
  x: number
  z: number
  y: number
  vx: number
  vy: number
  vz: number
  rot: THREE.Euler
  spinX: number
  spinY: number
  spinZ: number
  state: 0 | 1 | 2 // idle | flying | rested
  bounces: number
  index: number // instance index within its type's mesh
}

interface TypeDef {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  restY: number
}

const _o = new THREE.Object3D()
const _v = new THREE.Vector3()

export class Props {
  readonly group = new THREE.Group()
  onImpact: ((intensity: number) => void) | null = null

  private readonly props: Prop[] = []
  private readonly meshes: THREE.InstancedMesh[] = []
  private readonly water = new Dust({ color: [0.62, 0.78, 1], rise: 7.5, life: 0.9, size: 0.9, alpha: 0.75 })
  private readonly geysers: { x: number; z: number; t: number }[] = []
  private anyFlying = false

  // obstacles: the town's building footprints — props that would spawn inside
  // a wall (corner offsets can land in jittered buildings) are dropped
  constructor(obstacles: Obstacle[] = []) {
    const inWall = (x: number, z: number) =>
      obstacles.some(
        (o) => Math.abs(x - o.x) < o.hw + 0.6 && Math.abs(z - o.z) < o.hd + 0.6,
      )
    const types: TypeDef[] = [
      { geo: new THREE.ConeGeometry(0.32, 0.85, 9), mat: toonMat('#ff7f2a'), restY: 0.43 },
      { geo: new THREE.CylinderGeometry(0.42, 0.38, 0.95, 10), mat: toonMat('#6b7076'), restY: 0.48 },
      { geo: new THREE.BoxGeometry(0.55, 0.95, 0.5), mat: toonMat('#3d6bb0'), restY: 0.48 },
      { geo: new THREE.CylinderGeometry(0.26, 0.3, 0.75, 9), mat: toonMat('#c93a2e'), restY: 0.38 },
    ]
    const lists: { x: number; z: number }[][] = [[], [], [], []]

    // deterministic sprinkling over intersection corners and block edges
    for (let ia = 0; ia < CITY_AVENUES.length; ia++) {
      for (let is = 0; is < CITY_STREETS.length; is++) {
        const ax = CITY_AVENUES[ia]
        const sz = CITY_STREETS[is]
        const h = ia * 13 + is * 29
        if (h % 3 === 0) {
          const cx = h % 2 === 0 ? 1 : -1
          lists[3].push({ x: ax + cx * 10.4, z: sz + (h % 4 < 2 ? 10.4 : -10.4) }) // hydrant
        }
        if (h % 4 === 1) {
          lists[2].push({ x: ax - 10.2, z: sz - 10.2 }) // mailbox by the crosswalk
        }
        if (h % 7 === 2) {
          for (let c = 0; c < 4; c++) {
            const a = c * 0.55 + 0.4
            // sidewalk corner, fully clear of both roadways (>8 from center)
            lists[0].push({ x: ax + 11.5 + Math.sin(a) * 2.4, z: sz + 11.5 + Math.cos(a) * 2.4 })
          }
        }
      }
    }
    for (let ix = 0; ix < CITY_AVENUES.length - 1; ix++) {
      for (let iz = 0; iz < CITY_STREETS.length - 1; iz++) {
        if ((ix + iz * 2) % 2 !== 0) continue
        const midZ = (CITY_STREETS[iz] + CITY_STREETS[iz + 1]) / 2
        lists[1].push({ x: CITY_AVENUES[ix] + 9.3, z: midZ + ((ix * 7 + iz * 3) % 9) - 4 })
        lists[1].push({ x: CITY_AVENUES[ix + 1] - 9.3, z: midZ + ((ix * 3 + iz * 11) % 9) - 4 })
      }
    }

    for (let t = 0; t < types.length; t++) {
      lists[t] = lists[t].filter((p) => !inWall(p.x, p.z))
      const mesh = new THREE.InstancedMesh(types[t].geo, types[t].mat, Math.max(1, lists[t].length))
      mesh.castShadow = true
      lists[t].forEach((p, i) => {
        const prop: Prop = {
          type: t,
          x: p.x,
          z: p.z,
          y: types[t].restY,
          vx: 0,
          vy: 0,
          vz: 0,
          rot: new THREE.Euler(0, ((p.x * 7 + p.z * 3) % 6) * 0.9, 0),
          spinX: 0,
          spinY: 0,
          spinZ: 0,
          state: 0,
          bounces: 0,
          index: i,
        }
        this.props.push(prop)
        this.writeMatrix(mesh, prop)
      })
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    this.group.add(this.water.points)
  }

  private writeMatrix(mesh: THREE.InstancedMesh, p: Prop) {
    _o.position.set(p.x, p.y, p.z)
    _o.rotation.copy(p.rot)
    _o.updateMatrix()
    mesh.setMatrixAt(p.index, _o.matrix)
  }

  // ponytail: flung props animate at the raw 60Hz step, no render interpolation
  // — add a px/pz lerp like traffic's if the stutter ever reads bad on 120Hz+
  step(dt: number, playerX: number, playerZ: number, playerVx: number, playerVz: number) {
    const speed = Math.hypot(playerVx, playerVz)
    this.anyFlying = false

    for (const p of this.props) {
      if (p.state === 0 || p.state === 2) {
        if (speed < MIN_HIT_SPEED) continue
        const dx = p.x - playerX
        const dz = p.z - playerZ
        if (dx * dx + dz * dz > HIT_R * HIT_R) continue
        // clipped it — inherit the car's motion plus a hop and a tumble
        const firstHit = p.state === 0
        const kick = 0.45 + ((p.index * 29) % 10) / 18
        p.vx = playerVx * kick + dx * 2
        p.vz = playerVz * kick + dz * 2
        p.vy = 3.5 + ((p.index * 13) % 10) * 0.35
        p.spinX = 3 + ((p.index * 7) % 9)
        p.spinY = ((p.index * 11) % 7) - 3
        p.spinZ = 2 + ((p.index * 5) % 8)
        p.state = 1
        p.bounces = 0
        this.onImpact?.(Math.min(1, speed / 25))
        // the geyser is the broken street mount — only the first knock opens it
        if (p.type === 3 && firstHit && this.geysers.length < 3) {
          this.geysers.push({ x: p.x, z: p.z, t: GEYSER_LIFE })
        }
      }
      if (p.state !== 1) continue

      this.anyFlying = true
      p.x += p.vx * dt
      p.z += p.vz * dt
      p.vy -= GRAVITY * dt
      p.y += p.vy * dt
      p.rot.x += p.spinX * dt
      p.rot.y += p.spinY * dt
      p.rot.z += p.spinZ * dt
      const landY = LAND_Y[p.type]
      if (p.y <= landY && p.vy < 0) {
        p.y = landY
        p.bounces++
        if (p.bounces >= 2 || Math.hypot(p.vx, p.vz) < 1.2) {
          p.state = 2
          p.vx = p.vy = p.vz = 0
          // settle flat onto a side — all three axes, or a boxy prop with a
          // free yaw between snapped pitch/roll still balances on an edge
          p.rot.x = Math.round(p.rot.x / (Math.PI / 2)) * (Math.PI / 2)
          p.rot.y = Math.round(p.rot.y / (Math.PI / 2)) * (Math.PI / 2)
          p.rot.z = Math.round(p.rot.z / (Math.PI / 2)) * (Math.PI / 2)
        } else {
          p.vy *= -0.4
          p.vx *= 0.55
          p.vz *= 0.55
        }
      }
      this.writeMatrix(this.meshes[p.type], p)
    }

    if (this.anyFlying) {
      for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true
    }

    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const g = this.geysers[i]
      g.t -= dt
      _v.set(g.x, 0.3, g.z)
      this.water.emitFrom(_v, 90 * Math.min(1, g.t / 2), dt)
      if (g.t <= 0) this.geysers.splice(i, 1)
    }
    this.water.update(dt)
  }
}
