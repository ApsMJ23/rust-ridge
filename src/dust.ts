import * as THREE from 'three'

// Pooled particle sprites — fixed-size buffers, zero per-frame allocation,
// one draw call. Defaults are the drift dust; params make it a water geyser.
const MAX = 256

export interface DustOpts {
  color?: [number, number, number]
  rise?: number // m/s
  life?: number // s
  size?: number
  alpha?: number
}

export class Dust {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly age: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private readonly rise: number
  private readonly life: number
  private readonly alpha: number
  private cursor = 0
  private debt = 0

  constructor(opts: DustOpts = {}) {
    const color = opts.color ?? [0.85, 0.74, 0.56]
    this.rise = opts.rise ?? 1.6
    this.life = opts.life ?? 0.7
    this.alpha = opts.alpha ?? 0.45
    this.pos = new Float32Array(MAX * 3)
    this.col = new Float32Array(MAX * 4)
    this.age = new Float32Array(MAX).fill(this.life)
    for (let i = 0; i < MAX; i++) this.col.set([...color, 0], i * 4)

    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3)
    this.colAttr = new THREE.BufferAttribute(this.col, 4)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('color', this.colAttr)

    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: opts.size ?? 0.7,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
    )
    this.points.frustumCulled = false
  }

  // rate-based emission (particles/second) so density is framerate-independent
  emitFrom(at: THREE.Vector3, rate: number, dt: number) {
    this.debt += rate * dt
    while (this.debt >= 1) {
      this.debt -= 1
      const i = this.cursor
      this.cursor = (i + 1) % MAX
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.5
      this.pos[i * 3 + 1] = at.y
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.5
      this.age[i] = 0
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life) continue
      this.age[i] += dt
      this.pos[i * 3 + 1] += this.rise * dt
      this.col[i * 4 + 3] = this.age[i] >= this.life ? 0 : this.alpha * (1 - this.age[i] / this.life)
    }
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
  }
}
