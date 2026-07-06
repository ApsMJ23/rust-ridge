import type { Car } from './car.ts'
import type { MissionManager } from './mission.ts'
import type { MissionDef, Point } from './missions.ts'
import { CITY_AVENUES, CITY_BOUNDS, CITY_ROAD_W, CITY_STREETS } from './town.ts'

interface ScreenPoint {
  x: number
  y: number
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private mapLeft = 0
  private mapTop = 0
  private mapScale = 1

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly defs: MissionDef[],
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('minimap canvas unavailable')
    this.ctx = ctx
    this.resize()
    addEventListener('resize', () => this.resize())
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.cssW = Math.max(1, rect.width || 180)
    this.cssH = Math.max(1, rect.height || 180)
    this.dpr = Math.min(devicePixelRatio || 1, 2)
    const w = Math.round(this.cssW * this.dpr)
    const h = Math.round(this.cssH * this.dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    const pad = 12
    const worldW = CITY_BOUNDS.maxX - CITY_BOUNDS.minX
    const worldH = CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ
    this.mapScale = Math.min((this.cssW - pad * 2) / worldW, (this.cssH - pad * 2) / worldH)
    this.mapLeft = (this.cssW - worldW * this.mapScale) / 2
    this.mapTop = (this.cssH - worldH * this.mapScale) / 2
  }

  draw(car: Car, missions: MissionManager, titleOpen: boolean) {
    this.resize()
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.cssW, this.cssH)

    ctx.save()
    this.roundedRect(0, 0, this.cssW, this.cssH, 8)
    ctx.clip()
    ctx.fillStyle = 'rgba(24, 28, 32, 0.86)'
    ctx.fillRect(0, 0, this.cssW, this.cssH)
    this.drawCity()

    if (missions.state === 'running' || missions.state === 'won' || missions.state === 'lost') {
      if (missions.active) this.drawActiveRoute(missions.active, missions, car)
    } else {
      this.drawStartMarkers(missions)
    }

    this.drawCar(car)
    if (titleOpen) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.fillRect(0, 0, this.cssW, this.cssH)
    }
    ctx.restore()

    this.roundedRect(0.5, 0.5, this.cssW - 1, this.cssH - 1, 8)
    ctx.strokeStyle = 'rgba(255, 244, 207, 0.42)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  private drawCity() {
    const ctx = this.ctx
    this.drawWorldRect(CITY_BOUNDS.minX, CITY_BOUNDS.minZ, CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ, '#53625a')

    ctx.fillStyle = '#29313a'
    for (const x of CITY_AVENUES) {
      this.drawWorldRect(x - CITY_ROAD_W / 2, CITY_BOUNDS.minZ, x + CITY_ROAD_W / 2, CITY_BOUNDS.maxZ)
    }
    for (const z of CITY_STREETS) {
      this.drawWorldRect(CITY_BOUNDS.minX, z - CITY_ROAD_W / 2, CITY_BOUNDS.maxX, z + CITY_ROAD_W / 2)
    }

    ctx.strokeStyle = 'rgba(240, 234, 220, 0.18)'
    ctx.lineWidth = 1
    for (const x of CITY_AVENUES) {
      this.drawWorldPolyline([
        { x, z: CITY_BOUNDS.maxZ },
        { x, z: CITY_BOUNDS.minZ },
      ])
    }
    for (const z of CITY_STREETS) {
      this.drawWorldPolyline([
        { x: CITY_BOUNDS.minX, z },
        { x: CITY_BOUNDS.maxX, z },
      ])
    }
  }

  private drawStartMarkers(missions: MissionManager) {
    for (const def of this.defs) {
      const done = missions.completed[def.id] !== undefined
      this.drawRing(def.start, done ? '#59d98c' : def.color, done ? 3.8 : 3.2)
    }
  }

  private drawActiveRoute(def: MissionDef, missions: MissionManager, car: Car) {
    const ctx = this.ctx
    const route = this.routePoints(def)
    if (route.length === 0) return
    const obj = def.objective

    ctx.setLineDash([])
    ctx.strokeStyle = this.withAlpha(def.color, 0.42)
    ctx.lineWidth = 4
    if (obj.type === 'checkpoints' || obj.type === 'race' || obj.type === 'escape') {
      this.drawWorldPolyline([def.start, ...route])
    }

    if (obj.type === 'checkpoints' || obj.type === 'race') {
      const completed = Math.min(missions.index, route.length)
      if (completed > 0) {
        ctx.strokeStyle = '#59d98c'
        ctx.lineWidth = 4
        this.drawWorldPolyline([def.start, ...route.slice(0, completed)])
      }

      const next = route[completed]
      if (next) {
        ctx.save()
        ctx.setLineDash([5, 5])
        ctx.strokeStyle = 'rgba(255, 253, 246, 0.88)'
        ctx.lineWidth = 2
        this.drawWorldPolyline([{ x: car.x, z: car.z }, next])
        ctx.restore()
      }

      route.forEach((p, i) => {
        if (i < completed) this.drawDot(p, '#59d98c', 3.2)
        else if (i === completed) this.drawTarget(p, def.color)
        else this.drawDot(p, def.color, 2.8)
      })

      const rival = missions.rivalAI
      if (rival) this.drawDot(rival, '#ff2d55', 4)
    } else if (obj.type === 'escape') {
      this.drawTarget(obj.finish, '#59d98c')
      for (const c of missions.chaserAIs) this.drawDot(c, '#ff2d55', 4)
    } else if (obj.type === 'smash') {
      obj.targets.forEach((p, i) => {
        if (!missions.smashHit[i]) this.drawDot(p, def.color, 3.4)
      })
    } else {
      for (const p of route) this.drawDot(p, def.color, 3)
      if (obj.finish) this.drawTarget(obj.finish, '#59d98c')
    }
  }

  private routePoints(def: MissionDef): Point[] {
    const obj = def.objective
    if (obj.type === 'checkpoints' || obj.type === 'race') return obj.route
    if (obj.type === 'escape') return [obj.finish]
    if (obj.type === 'smash') return obj.targets
    return obj.finish ? [...obj.items, obj.finish] : obj.items
  }

  private drawCar(car: Car) {
    const ctx = this.ctx
    const p = this.project(car.x, car.z)
    const heading = car.visHeading
    const dx = -Math.sin(heading)
    const dy = Math.cos(heading)
    const rx = dy
    const ry = -dx

    ctx.beginPath()
    ctx.moveTo(p.x + dx * 8, p.y + dy * 8)
    ctx.lineTo(p.x - dx * 6 + rx * 5, p.y - dy * 6 + ry * 5)
    ctx.lineTo(p.x - dx * 6 - rx * 5, p.y - dy * 6 - ry * 5)
    ctx.closePath()
    ctx.fillStyle = '#ff7f2a'
    ctx.strokeStyle = '#fffdf6'
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()
  }

  private drawWorldRect(x1: number, z1: number, x2: number, z2: number, fill?: string) {
    const p1 = this.project(Math.min(x1, x2), Math.max(z1, z2))
    const p2 = this.project(Math.max(x1, x2), Math.min(z1, z2))
    if (fill) this.ctx.fillStyle = fill
    this.ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
  }

  private drawWorldPolyline(points: Point[]) {
    if (points.length < 2) return
    const ctx = this.ctx
    const start = this.project(points[0].x, points[0].z)
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    for (let i = 1; i < points.length; i++) {
      const p = this.project(points[i].x, points[i].z)
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  private drawRing(point: Point, color: string, radius: number) {
    const ctx = this.ctx
    const p = this.project(point.x, point.z)
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
  }

  private drawDot(point: Point, color: string, radius: number) {
    const ctx = this.ctx
    const p = this.project(point.x, point.z)
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }

  private drawTarget(point: Point, color: string) {
    this.drawDot(point, '#fffdf6', 5)
    this.drawRing(point, color, 6.8)
  }

  private project(x: number, z: number): ScreenPoint {
    return {
      x: this.mapLeft + (x - CITY_BOUNDS.minX) * this.mapScale,
      y: this.mapTop + (CITY_BOUNDS.maxZ - z) * this.mapScale,
    }
  }

  private roundedRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + w - rr, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
    ctx.lineTo(x + w, y + h - rr)
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
    ctx.lineTo(x + rr, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
    ctx.lineTo(x, y + rr)
    ctx.quadraticCurveTo(x, y, x + rr, y)
    ctx.closePath()
  }

  private withAlpha(hex: string, alpha: number) {
    const value = hex.replace('#', '')
    const r = parseInt(value.slice(0, 2), 16)
    const g = parseInt(value.slice(2, 4), 16)
    const b = parseInt(value.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
}
