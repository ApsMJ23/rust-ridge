import * as THREE from 'three'
import { toonMat } from './look.ts'
import type { MissionDef } from './missions.ts'
import { GridChaser, RouteRacer } from './rival.ts'

// Mission runtime: free-roam markers -> drive into one -> timed run -> result.
// DOM-free so the selfcheck exercises it in node.
export type GameState = 'idle' | 'running' | 'won' | 'lost'

const START_R2 = 25 // drive within 5m of a marker to begin
const PASS_R2 = 25 // checkpoint pass radius (5m, forgiving on purpose)
const ITEM_R2 = 16 // collect radius (4m)
const SMASH_R2 = 10.5 // crate hit radius (~3.2m — crates are big)
const CHASER_R2 = 7 // a chaser this close lands a hit
const STRIKES_MAX = 3
const LINGER = 5 // seconds a result screen stays before free roam returns

// box-art rival car for races and chases — same silhouette as traffic
function buildAICar(color: string): THREE.Group {
  const g = new THREE.Group()
  const dark = toonMat('#23262e')
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.75, 4.1), toonMat(color, null, 0.4, 0.15))
  body.position.y = 0.62
  body.castShadow = true
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 2.0), dark)
  cabin.position.set(0, 1.15, 0.3)
  g.add(body, cabin)
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 10)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const [wx, wz] of [[-0.78, -1.3], [0.78, -1.3], [-0.78, 1.3], [0.78, 1.3]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark)
    wheel.position.set(wx, 0.34, wz)
    g.add(wheel)
  }
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.14, 0.06),
    new THREE.MeshBasicMaterial({ color: '#fff3c4' }),
  )
  head.position.set(0, 0.62, -2.06)
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.14, 0.06),
    new THREE.MeshBasicMaterial({ color: '#e03a2a' }),
  )
  tail.position.set(0, 0.62, 2.06)
  g.add(head, tail)
  return g
}

function buildCrate(): THREE.Group {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.6), toonMat('#c08346'))
  box.castShadow = true
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 1.7), toonMat('#9be564'))
  lid.position.y = 0.81
  lid.castShadow = true
  g.add(box, lid)
  return g
}

export class MissionManager {
  state: GameState = 'idle'
  active: MissionDef | null = null
  timeLeft = 0
  elapsed = 0
  index = 0 // checkpoint progress
  collected = 0 // collect progress
  strikes = 0 // escape: hits taken
  smashed = 0 // smash: crates flattened
  smashHit: boolean[] = [] // per-target flags for the active smash run
  lastWinWasFirst = false
  lastWinWasRecord = false
  completed: Record<string, number> // mission id -> best time
  readonly group = new THREE.Group() // add to the scene

  private readonly defs: MissionDef[]
  private readonly markers: THREE.Group[] = []
  private readonly beacons: THREE.Mesh[] = []
  private readonly rings = new Map<string, THREE.Mesh[]>()
  private readonly items = new Map<string, THREE.Mesh[]>()
  private readonly finishes = new Map<string, THREE.Mesh>()
  private readonly racers = new Map<string, { ai: RouteRacer; mesh: THREE.Group }>()
  private readonly chaserUnits = new Map<string, { ai: GridChaser; mesh: THREE.Group }[]>()
  private readonly crates = new Map<string, THREE.Group[]>()
  private crateVel: { vx: number; vy: number; vz: number; rx: number; rz: number; t: number }[] = []
  private hitCd = 0 // post-strike immunity
  private px = 0 // player pos last update — gives the crates a fling direction
  private pz = 0
  private pulse = 0
  private linger = 0
  private rearm = false // after a result, don't auto-start a marker the car is parked on

  private static readonly NO_CHASERS: GridChaser[] = []

  // for the minimap: live AI positions during the active run
  get rivalAI(): RouteRacer | null {
    return this.active ? this.racers.get(this.active.id)?.ai ?? null : null
  }
  get rivalIndex(): number {
    return this.rivalAI?.wpIndex ?? 0
  }
  get chaserAIs(): GridChaser[] {
    const units = this.active ? this.chaserUnits.get(this.active.id) : undefined
    return units ? units.map((u) => u.ai) : MissionManager.NO_CHASERS
  }

  constructor(defs: MissionDef[], completed: Record<string, number> = {}) {
    this.defs = defs
    this.completed = completed

    const ringGeo = new THREE.TorusGeometry(3.5, 0.3, 8, 32)
    const markerGeo = new THREE.TorusGeometry(4, 0.25, 8, 32)
    const beaconGeo = new THREE.IcosahedronGeometry(0.55)
    // markers and rings are game UI — self-lit so they read at any light level
    const goal = new THREE.MeshBasicMaterial({ color: '#59d98c' })

    for (const def of defs) {
      const mat = new THREE.MeshBasicMaterial({ color: def.color })

      // flat start ring on the road + floating beacon visible from afar
      const marker = new THREE.Group()
      const startRing = new THREE.Mesh(markerGeo, mat)
      startRing.rotation.x = -Math.PI / 2
      startRing.position.y = 0.12
      const beacon = new THREE.Mesh(beaconGeo, mat)
      beacon.position.y = 3.2
      marker.add(startRing, beacon)
      marker.position.set(def.start.x, 0, def.start.z)
      this.group.add(marker)
      this.markers.push(marker)
      this.beacons.push(beacon)

      const obj = def.objective
      if (obj.type === 'checkpoints' || obj.type === 'race') {
        const list = obj.route.map((p, i) => {
          const ring = new THREE.Mesh(ringGeo, i === obj.route.length - 1 ? goal : mat)
          ring.position.set(p.x, 2.2, p.z)
          this.group.add(ring)
          return ring
        })
        this.rings.set(def.id, list)
        if (obj.type === 'race') {
          const mesh = buildAICar('#e0473d')
          mesh.visible = false
          this.group.add(mesh)
          this.racers.set(def.id, { ai: new RouteRacer(obj.route, obj.rivalSpeed), mesh })
        }
      } else if (obj.type === 'escape') {
        const f = new THREE.Mesh(ringGeo, goal)
        f.position.set(obj.finish.x, 2.2, obj.finish.z)
        this.group.add(f)
        this.finishes.set(def.id, f)
        const units = obj.chasers.map(() => {
          const mesh = buildAICar('#8a2f2a')
          mesh.visible = false
          this.group.add(mesh)
          return { ai: new GridChaser(obj.chaserSpeed), mesh }
        })
        this.chaserUnits.set(def.id, units)
      } else if (obj.type === 'smash') {
        const list = obj.targets.map((p) => {
          const crate = buildCrate()
          crate.position.set(p.x, 0.7, p.z)
          this.group.add(crate)
          return crate
        })
        this.crates.set(def.id, list)
      } else {
        const geo =
          obj.itemStyle === 'letter'
            ? new THREE.BoxGeometry(0.9, 0.6, 0.12)
            : new THREE.DodecahedronGeometry(0.8)
        const itemMat = new THREE.MeshBasicMaterial({ color: obj.itemStyle === 'letter' ? '#fffdf6' : '#a98548' })
        const list = obj.items.map((p) => {
          const item = new THREE.Mesh(geo, itemMat)
          item.position.set(p.x, 1.1, p.z)
          this.group.add(item)
          return item
        })
        this.items.set(def.id, list)
        if (obj.finish) {
          const f = new THREE.Mesh(ringGeo, goal)
          f.position.set(obj.finish.x, 2.2, obj.finish.z)
          this.group.add(f)
          this.finishes.set(def.id, f)
        }
      }
    }
    this.syncVisibility()
  }

  update(dt: number, x: number, z: number) {
    this.pulse += dt
    // player motion since last update — the fling direction for smashed crates
    const pdx = x - this.px
    const pdz = z - this.pz
    this.px = x
    this.pz = z

    if (this.state === 'idle') {
      for (let i = 0; i < this.beacons.length; i++) {
        this.beacons[i].position.y = 3.2 + 0.35 * Math.sin(this.pulse * 2 + i * 1.7)
        this.beacons[i].rotation.y = this.pulse + i
      }
      let inside = false
      for (const def of this.defs) {
        const dx = x - def.start.x
        const dz = z - def.start.z
        if (dx * dx + dz * dz < START_R2) {
          inside = true
          if (!this.rearm) {
            this.begin(def)
            break
          }
        }
      }
      if (!inside) this.rearm = false // re-arm once the car has left every marker
      return
    }

    if (this.state === 'won' || this.state === 'lost') {
      this.animateCrates(dt) // mid-air crates finish their tumble on the result screen
      this.linger -= dt
      if (this.linger <= 0) {
        this.state = 'idle'
        this.active = null
        this.rearm = true // finishing while parked on a marker must not chain into it
        this.syncVisibility()
      }
      return
    }

    // running
    this.elapsed += dt
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.timeLeft = 0
      this.state = 'lost'
      this.linger = LINGER
      this.syncVisibility()
      return
    }

    const def = this.active!
    const obj = def.objective
    if (obj.type === 'checkpoints' || obj.type === 'race') {
      const list = this.rings.get(def.id)!
      const cur = list[this.index]
      if (cur) {
        const s = 1 + 0.08 * Math.sin(this.pulse * 6)
        cur.scale.set(s, s, s)
      }
      const p = obj.route[this.index]
      const dx = x - p.x
      const dz = z - p.z
      if (dx * dx + dz * dz < PASS_R2) {
        if (cur) {
          cur.scale.set(1, 1, 1)
          cur.visible = false
        }
        this.index++
        if (this.index >= obj.route.length) {
          this.win(def)
          return
        }
      }
      if (obj.type === 'race') {
        const r = this.racers.get(def.id)!
        r.ai.step(dt)
        r.mesh.position.set(r.ai.x, 0, r.ai.z)
        r.mesh.rotation.y = r.ai.heading
        if (r.ai.done) {
          // he crossed the last ring before you did
          this.state = 'lost'
          this.linger = LINGER
          this.syncVisibility()
        }
      }
    } else if (obj.type === 'escape') {
      this.hitCd = Math.max(0, this.hitCd - dt)
      const units = this.chaserUnits.get(def.id)!
      for (const u of units) {
        u.ai.step(dt, x, z)
        u.mesh.position.set(u.ai.x, 0, u.ai.z)
        u.mesh.rotation.y = u.ai.heading
        if (this.hitCd === 0) {
          const cdx = x - u.ai.x
          const cdz = z - u.ai.z
          if (cdx * cdx + cdz * cdz < CHASER_R2) {
            this.strikes++
            this.hitCd = 1.4
            u.ai.knockback()
            if (this.strikes >= STRIKES_MAX) {
              this.state = 'lost'
              this.linger = LINGER
              this.syncVisibility()
              return
            }
          }
        }
      }
      const finish = this.finishes.get(def.id)!
      const s = 1 + 0.08 * Math.sin(this.pulse * 6)
      finish.scale.set(s, s, s)
      const fdx = x - obj.finish.x
      const fdz = z - obj.finish.z
      if (fdx * fdx + fdz * fdz < PASS_R2) this.win(def)
    } else if (obj.type === 'smash') {
      const list = this.crates.get(def.id)!
      const pvx = pdx / dt
      const pvz = pdz / dt
      for (let i = 0; i < list.length; i++) {
        if (this.smashHit[i]) continue
        const p = obj.targets[i]
        const dx = x - p.x
        const dz = z - p.z
        if (dx * dx + dz * dz < SMASH_R2) {
          this.smashHit[i] = true
          this.smashed++
          const v = this.crateVel[i]
          v.vx = pvx * 0.7
          v.vz = pvz * 0.7
          v.vy = 5.5
          v.rx = 4 + (i % 5)
          v.rz = 3 + (i % 4)
          v.t = 0.0001
        }
      }
      this.animateCrates(dt)
      if (this.smashed >= obj.targets.length) this.win(def)
    } else {
      const list = this.items.get(def.id)!
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        if (!item.visible) continue
        item.rotation.y += dt * 3
        item.position.y = 1.1 + 0.25 * Math.sin(this.pulse * 3 + i)
        const p = obj.items[i]
        const dx = x - p.x
        const dz = z - p.z
        if (dx * dx + dz * dz < ITEM_R2) {
          item.visible = false
          this.collected++
        }
      }
      if (this.collected >= obj.items.length) {
        const finish = this.finishes.get(def.id)
        if (!finish) {
          this.win(def)
          return
        }
        finish.visible = true
        const s = 1 + 0.08 * Math.sin(this.pulse * 6)
        finish.scale.set(s, s, s)
        const dx = x - obj.finish!.x
        const dz = z - obj.finish!.z
        if (dx * dx + dz * dz < PASS_R2) this.win(def)
      }
    }
  }

  // flung crates tumble off ballistically, then vanish — runs while the smash
  // mission is live AND through its result screen so the last hit finishes
  private animateCrates(dt: number) {
    const def = this.active
    if (!def || def.objective.type !== 'smash') return
    const list = this.crates.get(def.id)!
    for (let i = 0; i < list.length; i++) {
      const v = this.crateVel[i]
      if (!v || v.t <= 0 || v.t >= 2.2) continue
      const crate = list[i]
      v.t += dt
      v.vy -= 13 * dt
      crate.position.x += v.vx * dt
      crate.position.y = Math.max(0.4, crate.position.y + v.vy * dt)
      crate.position.z += v.vz * dt
      crate.rotation.x += v.rx * dt
      crate.rotation.z += v.rz * dt
      if (v.t >= 2.2) crate.visible = false
    }
  }

  // restart the active mission (running or on a result screen); returns the
  // retry pose, or null in free roam — there R just respawns the car
  retry(): { x: number; z: number; heading: number } | null {
    const def = this.active
    if (!def) return null
    this.begin(def)
    return def.start
  }

  private begin(def: MissionDef) {
    this.active = def
    this.state = 'running'
    this.elapsed = 0
    this.timeLeft = def.timeLimit
    this.index = 0
    this.collected = 0
    this.strikes = 0
    this.smashed = 0
    this.hitCd = 0
    this.px = def.start.x
    this.pz = def.start.z

    const obj = def.objective
    if (obj.type === 'race') {
      // rival lines up beside the player on the start marker
      const h = def.start.heading
      const r = this.racers.get(def.id)!
      r.ai.reset(def.start.x + Math.cos(h) * 3.2, def.start.z - Math.sin(h) * 3.2, h)
      r.mesh.position.set(r.ai.x, 0, r.ai.z) // else one frame at the stale spot
      r.mesh.rotation.y = r.ai.heading
    } else if (obj.type === 'escape') {
      const units = this.chaserUnits.get(def.id)!
      obj.chasers.forEach((p, i) => {
        units[i].ai.reset(p.x, p.z)
        units[i].mesh.position.set(units[i].ai.x, 0, units[i].ai.z)
        units[i].mesh.rotation.y = units[i].ai.heading
      })
    } else if (obj.type === 'smash') {
      this.smashHit = obj.targets.map(() => false)
      this.crateVel = obj.targets.map(() => ({ vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, t: 0 }))
      const list = this.crates.get(def.id)!
      list.forEach((crate, i) => {
        crate.position.set(obj.targets[i].x, 0.7, obj.targets[i].z)
        crate.rotation.set(0, 0, 0)
      })
    }
    this.syncVisibility()
  }

  private win(def: MissionDef) {
    this.state = 'won'
    this.linger = LINGER
    const prev = this.completed[def.id]
    this.lastWinWasFirst = prev === undefined
    this.lastWinWasRecord = prev === undefined || this.elapsed < prev
    if (this.lastWinWasRecord) this.completed[def.id] = this.elapsed
    this.syncVisibility()
  }

  private syncVisibility() {
    const idle = this.state === 'idle'
    for (const m of this.markers) m.visible = idle
    for (const [id, list] of this.rings) {
      const activeRun = this.state === 'running' && this.active?.id === id
      list.forEach((ring, i) => {
        ring.visible = activeRun && i >= this.index
        ring.scale.set(1, 1, 1)
      })
    }
    for (const [id, list] of this.items) {
      const activeRun = this.state === 'running' && this.active?.id === id
      for (const item of list) item.visible = activeRun
    }
    for (const [id, f] of this.finishes) {
      // escape finishes glow for the whole run; collect finishes only unlock
      // once every item is picked up (update() flips them on)
      f.visible =
        this.state === 'running' &&
        this.active?.id === id &&
        this.active.objective.type === 'escape'
      f.scale.set(1, 1, 1)
    }
    for (const [id, r] of this.racers) {
      r.mesh.visible = this.state === 'running' && this.active?.id === id
    }
    for (const [id, units] of this.chaserUnits) {
      const activeRun = this.state === 'running' && this.active?.id === id
      for (const u of units) u.mesh.visible = activeRun
    }
    for (const [id, list] of this.crates) {
      // stay visible through the result screen so mid-air crates land on camera
      const live = this.state !== 'idle' && this.active?.id === id
      list.forEach((crate, i) => {
        crate.visible = live && !(this.smashHit[i] && this.crateVel[i]?.t >= 2.2)
      })
    }
  }
}
