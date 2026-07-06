import { CITY_AVENUES, CITY_STREETS } from './town.ts'
import type { Point } from './missions.ts'

// AI drivers for missions — pure kinematics, browser-free so the selfcheck
// can race them in node. Shares the game's heading convention:
// forward = (-sin h, -cos h).

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Steer-toward-target driver: turn-rate-limited yaw, slows for sharp corners.
// The race rival runs this over the mission's checkpoint route (routes are
// axis-aligned street legs, so the straight lines between waypoints are roads).
export class RouteRacer {
  x = 0
  z = 0
  heading = 0
  speed = 0
  wpIndex = 0
  done = false
  private readonly route: Point[]
  private readonly maxSpeed: number
  private readonly accel: number
  private readonly turnRate: number

  // parameter properties would be nicer, but node strip-only TS (selfcheck) can't run them
  constructor(route: Point[], maxSpeed: number, accel = 12, turnRate = 2.4) {
    this.route = route
    this.maxSpeed = maxSpeed
    this.accel = accel
    this.turnRate = turnRate
  }

  reset(x: number, z: number, heading: number) {
    this.x = x
    this.z = z
    this.heading = heading
    this.speed = 0
    this.wpIndex = 0
    this.done = false
  }

  step(dt: number) {
    if (this.done) {
      this.speed = Math.max(0, this.speed - 14 * dt)
    } else {
      const wp = this.route[this.wpIndex]
      const dx = wp.x - this.x
      const dz = wp.z - this.z
      if (dx * dx + dz * dz < 30) {
        this.wpIndex++
        if (this.wpIndex >= this.route.length) this.done = true
      }
      const bearing = Math.atan2(-dx, -dz)
      const err = wrapAngle(bearing - this.heading)
      this.heading += clamp(err, -this.turnRate * dt, this.turnRate * dt)
      // brake into corners, floor it on the straights
      const target = Math.abs(err) > 0.5 ? Math.min(this.maxSpeed, 7) : this.maxSpeed
      this.speed += clamp(target - this.speed, -20 * dt, this.accel * dt)
    }
    this.x += -Math.sin(this.heading) * this.speed * dt
    this.z += -Math.cos(this.heading) * this.speed * dt
  }
}

// Pac-Man pursuit on the road grid: drive the current road, and at every
// intersection turn toward whichever axis has the bigger gap to the player.
// Never leaves the roads, so it reads as an actual driver hunting you down.
export class GridChaser {
  x = 0
  z = 0
  heading = 0
  speed = 0
  private axis: 'x' | 'z' = 'z'
  private sign = 1
  private road = 0 // coordinate of the road being driven
  private knockT = 0 // rammed the player: back off briefly
  private readonly maxSpeed: number

  constructor(maxSpeed: number) {
    this.maxSpeed = maxSpeed
  }

  reset(x: number, z: number) {
    // snap to the nearest avenue and drive from there
    this.road = nearest(CITY_AVENUES, x)
    this.x = this.road
    this.z = z
    this.axis = 'z'
    this.sign = 1
    this.speed = 0
    this.knockT = 0
    this.heading = 0
  }

  knockback() {
    this.knockT = 0.9
  }

  step(dt: number, targetX: number, targetZ: number) {
    const dir = this.knockT > 0 ? -0.5 : 1
    this.knockT = Math.max(0, this.knockT - dt)
    this.speed += clamp(this.maxSpeed * dir - this.speed, -30 * dt, 10 * dt)

    const move = this.speed * dt
    if (this.axis === 'z') {
      const before = this.z
      this.z += this.sign * move
      // crossed a street? maybe turn toward the player
      for (const s of CITY_STREETS) {
        const crossed = this.sign > 0 ? before < s && this.z >= s : before > s && this.z <= s
        if (!crossed || this.knockT > 0) continue
        if (Math.abs(targetX - this.x) > Math.abs(targetZ - this.z)) {
          this.z = s
          this.road = s
          this.axis = 'x'
          this.sign = targetX > this.x ? 1 : -1
        } else {
          this.sign = targetZ > this.z ? 1 : -1
        }
        break
      }
      this.x += (this.road - this.x) * Math.min(1, 4 * dt)
    } else {
      const before = this.x
      this.x += this.sign * move
      for (const a of CITY_AVENUES) {
        const crossed = this.sign > 0 ? before < a && this.x >= a : before > a && this.x <= a
        if (!crossed || this.knockT > 0) continue
        if (Math.abs(targetZ - this.z) > Math.abs(targetX - this.x)) {
          this.x = a
          this.road = a
          this.axis = 'z'
          this.sign = targetZ > this.z ? 1 : -1
        } else {
          this.sign = targetX > this.x ? 1 : -1
        }
        break
      }
      this.z += (this.road - this.z) * Math.min(1, 4 * dt)
    }

    // ran off the end of the grid — turn back toward town
    if (this.axis === 'z') {
      if (this.z > CITY_STREETS[0] + 12) this.sign = -1
      else if (this.z < CITY_STREETS[CITY_STREETS.length - 1] - 12) this.sign = 1
    } else {
      if (this.x > CITY_AVENUES[CITY_AVENUES.length - 1] + 12) this.sign = -1
      else if (this.x < CITY_AVENUES[0] - 12) this.sign = 1
    }

    // visual heading follows travel direction
    const want = this.axis === 'z' ? (this.sign > 0 ? Math.PI : 0) : this.sign > 0 ? -Math.PI / 2 : Math.PI / 2
    this.heading += wrapAngle(want - this.heading) * Math.min(1, 6 * dt)
  }
}

function nearest(list: readonly number[], v: number): number {
  let best = list[0]
  for (const c of list) if (Math.abs(c - v) < Math.abs(best - v)) best = c
  return best
}
