import * as THREE from 'three'
import type { Controls } from './input.ts'
import { toonMat } from './look.ts'
import { TUNING as T } from './tuning.ts'

// axis-aligned wall footprint (buildings); the car collides as a circle
export interface Obstacle {
  x: number
  z: number
  hw: number // half width (x)
  hd: number // half depth (z)
}

const CAR_RADIUS = 1.1

// downshift only once ratio falls this far below the upshift point — same
// hysteresis a real automatic uses so it doesn't hunt at a boundary speed
const DOWNSHIFT_MARGIN = 0.04
export type GearMode = 'auto' | 'manual'

// Arcade car with drift: momentum is a world-space velocity vector that the
// tires continuously pull toward the nose. Grip = how fast lateral momentum
// dies; the handbrake lowers it, which IS the drift mechanic.
// Still kinematic, no physics engine. The tuning surface is kept isolated so
// future terrain or suspension work can slot in without rewriting handling.
export class Car {
  readonly mesh: THREE.Group

  // physics state, stepped at a fixed 60Hz
  x = 0
  z = 0
  heading = 0 // yaw, rad; forward is (-sin h, -cos h)
  vx = 0
  vz = 0
  vF = 0 // speed along the nose, m/s (negative = reversing)
  vL = 0 // lateral slide, m/s (positive = sliding toward the car's right)

  // interpolated heading for the camera, valid after renderSync
  visHeading = 0

  // gearbox state (derived from speed each step). Bands are evenly spaced
  // fractions of maxSpeed — cars differ by count (setGears), so a 4-speed
  // truck and a 6-speed racer each get gears that last a fair, equal share
  // of their own speed range, not a slice of someone else's.
  gear = 1 // 1..bands.length
  rpm = 0 // 0..1 within the current gear's band
  gearMode: GearMode = 'auto'
  shiftSerial = 0
  shiftDirection: -1 | 1 = 1
  private bands: number[] = [0.2, 0.4, 0.6, 0.8, 1] // default: even 5-speed
  private shiftTimer = 0

  get shifting() {
    return this.shiftTimer > 0
  }

  get gearCount() {
    return this.bands.length
  }

  // called when swapping cars — each has its own number of gears
  setGears(count: number) {
    this.bands = Array.from({ length: count }, (_, i) => (i + 1) / count)
    this.gear = 1
    this.rpm = 0
    this.shiftTimer = 0
  }

  setGearMode(mode: GearMode) {
    this.gearMode = mode
    this.gear = THREE.MathUtils.clamp(this.gear, 1, this.bands.length)
  }

  toggleGearMode(): GearMode {
    this.setGearMode(this.gearMode === 'auto' ? 'manual' : 'auto')
    return this.gearMode
  }

  shiftUp() {
    return this.selectGear(this.gear + 1)
  }

  shiftDown() {
    return this.selectGear(this.gear - 1)
  }

  private selectGear(next: number) {
    if (this.gearMode !== 'manual') this.gearMode = 'manual'
    const gear = THREE.MathUtils.clamp(Math.round(next), 1, this.bands.length)
    if (gear === this.gear) return false
    this.triggerShift(gear > this.gear ? 1 : -1, gear > this.gear ? T.shiftCut : T.shiftCut * 0.65)
    this.gear = gear
    return true
  }

  private triggerShift(direction: -1 | 1, duration: number) {
    this.shiftDirection = direction
    this.shiftTimer = Math.max(this.shiftTimer, duration)
    this.shiftSerial++
  }

  private readonly body: THREE.Group
  private wheels: THREE.Object3D[] = []
  private frontWheels: THREE.Object3D[] = []
  private px = 0
  private pz = 0
  private pheading = 0
  private accel = 0
  private steer = 0
  private roll = 0
  private pitch = 0
  private steerVis = 0
  private wheelSpin = 0
  private loadSeq = 0

  get speed() {
    return Math.hypot(this.vx, this.vz)
  }

  constructor() {
    this.body = buildFallbackBody()
    this.mesh = new THREE.Group()
    this.mesh.add(this.body, buildPizzaTopper())
  }

  step(dt: number, c: Controls, obstacles: Obstacle[] = []) {
    this.px = this.x
    this.pz = this.z
    this.pheading = this.heading

    // steering: yaw authority fades with speed; scaling by velocity sign means
    // no turning in place and mirrored steering in reverse, like a real car
    this.steer = c.steer
    const falloff = 1 / (1 + Math.abs(this.vF) * T.steerFalloff)
    const moving = THREE.MathUtils.clamp(this.vF / 3, -1, 1)
    const steerBoost = 1 + c.brake * T.brakeSteer + (c.handbrake ? T.handbrakeSteer : 0)
    this.heading += c.steer * T.steerRate * steerBoost * falloff * moving * dt

    // decompose momentum in the car frame under the new heading — steering
    // converts forward momentum into lateral, and grip bleeds it back out
    const fx = -Math.sin(this.heading)
    const fz = -Math.cos(this.heading)
    const rx = Math.cos(this.heading)
    const rz = -Math.sin(this.heading)
    let vF = this.vx * fx + this.vz * fz
    let vL = this.vx * rx + this.vz * rz

    // longitudinal: throttle, brake (reverse once stopped), or coast to zero
    let a = 0
    if (c.throttle > 0 && c.brake > 0) {
      // pedal conflict: brake wins — decelerate to a dead stop and hold there
      a = -Math.sign(vF) * Math.min(Math.abs(vF) / dt, T.brake)
    } else if (c.throttle > 0) {
      a = c.throttle * T.accel * this.manualTorque(vF)
    } else if (c.brake > 0) {
      a = -c.brake * (vF > 0.5 ? T.brake : T.accel)
    } else if (vF !== 0) {
      // engine braking: lower gears grab harder off-throttle than higher gears,
      // like a real drivetrain. this.gear is last frame's — one step of lag,
      // imperceptible at 60Hz, and avoids ordering this after gear selection.
      const driveGear = vF < 0 ? 1 : this.gear
      const engineBrake = 1 + (this.bands.length - driveGear) * T.engineBraking
      const dec = Math.min(Math.abs(vF) / dt, (T.rollDecel + Math.abs(vF) * T.drag) * engineBrake)
      a = -Math.sign(vF) * dec
    }
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt
      if (a > 0) a *= 0.15 // the gearbox grabs the next gear — brief torque dip
    }
    this.accel = a
    vF = THREE.MathUtils.clamp(vF + a * dt, -T.maxReverse, T.maxSpeed)
    vF = this.applyManualGearLimit(vF, dt)

    // gearbox: pick the band for the current speed, rev within it
    const ratio = Math.abs(vF) / T.maxSpeed
    if (vF < 0) {
      this.rpm = THREE.MathUtils.clamp(ratio / this.bands[0], 0, 1)
      if (this.gearMode === 'auto') this.gear = 1 // reverse never upshifts
    } else if (this.gearMode === 'auto') {
      // start from the current gear (not always 1) so the downshift check
      // below can apply hysteresis instead of snapping straight to the band
      let gear = this.gear
      while (gear < this.bands.length && ratio > this.bands[gear - 1]) gear++
      while (gear > 1 && ratio < this.bands[gear - 2] - DOWNSHIFT_MARGIN) gear--
      if (gear !== this.gear) {
        this.triggerShift(gear > this.gear ? 1 : -1, gear > this.gear ? T.shiftCut : T.shiftCut * 0.65)
      }
      this.gear = gear
      const lo = gear === 1 ? 0 : this.bands[gear - 2]
      const band = THREE.MathUtils.clamp((ratio - lo) / (this.bands[gear - 1] - lo), 0, 1)
      // revs drop to ~40%, not to idle — a shift should sound like a shift,
      // not like the engine dying and restarting
      this.rpm = gear === 1 ? band : 0.4 + 0.6 * band
    } else {
      this.rpm = this.rpmForGear(ratio, this.gear)
    }

    // lateral: tires bleed sideways momentum; the handbrake keeps it alive
    const grip = (c.handbrake ? T.driftGrip : T.grip) * (1 + c.brake * T.brakeGrip)
    vL *= Math.exp(-grip * dt)
    if (Math.abs(vL) < 0.01) vL = 0 // snap so drifts (and floats) actually end
    if (Math.abs(vL) > 0.5 && Math.abs(vF) > 0) {
      const slideLoss = Math.min(Math.abs(vF), Math.abs(vL) * T.slideDrag * dt)
      vF -= Math.sign(vF) * slideLoss
    }

    // cap TOTAL speed at maxSpeed — otherwise drift entry at top speed lets the
    // throttle refill vF while vL holds the surplus, a free boost past the cap
    vF = Math.min(vF, Math.sqrt(Math.max(0, T.maxSpeed * T.maxSpeed - vL * vL)))

    this.vx = fx * vF + rx * vL
    this.vz = fz * vF + rz * vL
    this.x += this.vx * dt
    this.z += this.vz * dt

    // walls: circle-vs-AABB push-out; the along-wall velocity survives (slide)
    for (const b of obstacles) {
      const cx = THREE.MathUtils.clamp(this.x, b.x - b.hw, b.x + b.hw)
      const cz = THREE.MathUtils.clamp(this.z, b.z - b.hd, b.z + b.hd)
      let dx = this.x - cx
      let dz = this.z - cz
      const d2 = dx * dx + dz * dz
      if (d2 >= CAR_RADIUS * CAR_RADIUS) continue
      let d = Math.sqrt(d2)
      if (d < 1e-6) {
        // Center-inside-wall should not happen at normal step sizes; arbitrary
        // push guards against NaN if a future teleport lands inside.
        dx = 0
        dz = 1
        d = 1
      }
      const nx = dx / d
      const nz = dz / d
      this.x = cx + nx * CAR_RADIUS
      this.z = cz + nz * CAR_RADIUS
      const vn = this.vx * nx + this.vz * nz
      if (vn < 0) {
        this.vx -= vn * nx
        this.vz -= vn * nz
      }
    }
    // re-derive body-frame speeds after any wall contact
    this.vF = this.vx * fx + this.vz * fz
    this.vL = this.vx * rx + this.vz * rz
  }

  private manualTorque(vF: number) {
    if (this.gearMode !== 'manual' || vF < -0.5) return 1
    const ratio = Math.max(0, vF) / T.maxSpeed
    const hi = this.bands[this.gear - 1]
    const lo = this.gear === 1 ? 0 : this.bands[this.gear - 2]
    const span = hi - lo
    const band = span > 0 ? THREE.MathUtils.clamp((ratio - lo) / span, 0, 1) : 1
    const powerBand = 1.08 - 0.18 * band
    const lug = this.gear > 1 && ratio < lo ? THREE.MathUtils.lerp(T.manualLug, 1, ratio / lo) : 1
    const overrev = ratio > hi ? 0.12 : 1
    return powerBand * lug * overrev
  }

  private applyManualGearLimit(vF: number, dt: number) {
    if (this.gearMode !== 'manual' || vF <= 0) return vF
    const maxForGear = this.bands[this.gear - 1] * T.maxSpeed
    if (vF <= maxForGear) return vF
    const excess = vF - maxForGear
    return vF - Math.min(excess, (T.manualOverrevDrag + excess * 2) * dt)
  }

  private rpmForGear(ratio: number, gear: number) {
    const lo = gear === 1 ? 0 : this.bands[gear - 2]
    const hi = this.bands[gear - 1]
    const span = hi - lo
    const band = span > 0 ? THREE.MathUtils.clamp((ratio - lo) / span, 0, 1) : 1
    return gear === 1 ? band : 0.4 + 0.6 * band
  }

  // teleport for spawn/instant restart — also resets interpolation and visuals
  resetTo(x: number, z: number, heading: number) {
    this.x = this.px = x
    this.z = this.pz = z
    this.heading = this.pheading = this.visHeading = heading
    this.vx = this.vz = this.vF = this.vL = 0
    this.accel = this.steer = this.roll = this.pitch = this.steerVis = 0
    this.gear = 1
    this.rpm = 0
    this.shiftTimer = 0
    this.mesh.position.set(x, 0, z)
    this.mesh.rotation.y = heading
  }

  // once per rendered frame; alpha blends the last two physics steps
  renderSync(alpha: number, dt: number) {
    this.mesh.position.x = THREE.MathUtils.lerp(this.px, this.x, alpha)
    this.mesh.position.z = THREE.MathUtils.lerp(this.pz, this.z, alpha)
    this.visHeading = THREE.MathUtils.lerp(this.pheading, this.heading, alpha)
    this.mesh.rotation.y = this.visHeading

    // visual-only body lean: roll out of slides, pitch under accel/brake
    const k = 1 - Math.exp(-8 * dt)
    const rollTarget = THREE.MathUtils.clamp(-this.vL * T.leanRoll, -0.12, 0.12)
    this.roll += (rollTarget - this.roll) * k
    this.pitch += (this.accel * T.leanPitch - this.pitch) * k
    this.body.rotation.z = this.roll
    this.body.rotation.x = this.pitch

    // wheels: spin with travel, front pair yaws with steering
    this.wheelSpin = (this.wheelSpin - (this.vF * dt) / 0.35) % (Math.PI * 2)
    this.steerVis += (this.steer * 0.35 - this.steerVis) * k
    for (const w of this.wheels) w.rotation.x = this.wheelSpin
    for (const w of this.frontWheels) w.rotation.y = this.steerVis
  }

  // world position of a rear wheel (side: -1 left, 1 right), written into out
  rearWheelWorld(side: -1 | 1, out: THREE.Vector3) {
    const h = this.visHeading
    const lx = side * 0.85
    const lz = 1.35
    out.set(
      this.mesh.position.x + lx * Math.cos(h) + lz * Math.sin(h),
      0.15,
      this.mesh.position.z - lx * Math.sin(h) + lz * Math.cos(h),
    )
  }

  // swap the fallback box for a glTF model; keeps the box if loading fails.
  // recolor overrides material colors by material name — the paint booth.
  // browser-only — never called from selfcheck/node.
  async loadModel(url: string, recolor?: Record<string, string>) {
    const seq = ++this.loadSeq
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const gltf = await new GLTFLoader().loadAsync(url)
    if (seq !== this.loadSeq) {
      // a newer load superseded this one — discard, or quick G-G swaps could
      // leave whichever model resolved last on screen
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.geometry.dispose()
        const mat = m.material as THREE.MeshStandardMaterial
        mat.map?.dispose()
        mat.dispose()
      })
      return
    }
    const model = gltf.scene
    model.rotation.y = Math.PI // kenney cars face +z; our forward is -z

    // normalize: scale to the physics footprint (4.2m long), recenter the
    // pivot (racing-kit models have off-center origins), sit on the ground
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(4.2 / Math.max(size.x, size.z))
    box.setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y = -box.min.y

    // free the outgoing body's GPU resources (fallback box or previous car)
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh
        m.geometry.dispose()
        const mat = m.material as THREE.MeshStandardMaterial
        mat.map?.dispose() // the model's own colormap — the toon gradient is shared
        mat.dispose()
      }
    })
    this.body.clear()
    this.body.add(model)
    this.wheels = []
    this.frontWheels = []
    model.traverse((o) => {
      // realistic pass: keep the glTF's own PBR materials, just tune them so
      // the paint picks up the environment reflections, and cast shadows
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.isMeshStandardMaterial) {
          // 2018-era kits (racing kit) ship double-gamma colors — pale pastels.
          // Re-linearizing restores the vivid paint; textured kits are fine.
          if (!mat.map) mat.color.convertSRGBToLinear()
          const paint = recolor?.[mat.name]
          if (paint) mat.color.set(paint)
          mat.roughness = Math.min(mat.roughness, 0.5)
          mat.metalness = Math.max(mat.metalness, 0.1)
        }
      }
      // wheel nodes across kits: 'wheel-front-right' (car kit) and
      // 'wheelFrontLeft' + 'Mesh_wheelFrontLeft' children (racing kit) —
      // match case-insensitively and only the outermost wheel node
      const lname = o.name.toLowerCase()
      if (!lname.includes('wheel')) return
      if (o.parent && o.parent.name.toLowerCase().includes('wheel')) return
      this.wheels.push(o)
      if (lname.includes('front')) {
        o.rotation.order = 'YXZ' // steer yaw first, then spin
        this.frontWheels.push(o)
      }
    })
  }
}

function buildFallbackBody(): THREE.Group {
  const body = new THREE.Group()
  const paint = toonMat('#e8734a')
  const dark = toonMat('#2f2f38')

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.2), paint)
  chassis.position.y = 0.55
  chassis.castShadow = true
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.9), dark)
  cabin.position.set(0, 1.0, 0.35) // set back, so the front reads as the hood
  cabin.castShadow = true
  body.add(chassis, cabin)

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const [wx, wz] of [
    [-0.85, -1.35],
    [0.85, -1.35],
    [-0.85, 1.35],
    [0.85, 1.35],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, dark)
    wheel.position.set(wx, 0.36, wz)
    body.add(wheel)
  }
  return body
}

function buildPizzaTopper(): THREE.Group {
  const topper = new THREE.Group()
  const boxMat = toonMat('#f5d16d')
  const red = toonMat('#d43f32')
  const cheese = toonMat('#ffd66b')
  const crust = toonMat('#b86d3b')

  const box = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.2, 1.05), boxMat)
  box.position.set(0, 1.48, -0.08)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.16), red)
  stripe.position.set(0, 1.61, -0.08)

  const sliceShape = new THREE.Shape()
  sliceShape.moveTo(0, 0.42)
  sliceShape.lineTo(-0.35, -0.3)
  sliceShape.lineTo(0.35, -0.3)
  sliceShape.lineTo(0, 0.42)
  const slice = new THREE.Mesh(new THREE.ShapeGeometry(sliceShape), cheese)
  slice.rotation.x = -Math.PI / 2
  slice.position.set(0, 1.72, -0.08)
  slice.scale.setScalar(0.75)

  const crustEdge = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.11), crust)
  crustEdge.position.set(0, 1.735, 0.17)

  topper.add(box, stripe, slice, crustEdge)
  return topper
}
