import * as THREE from 'three'

// Pooled tire-mark ribbon: a ring buffer of quads written while drifting,
// fading out by vertex alpha. Fixed buffers, zero per-frame allocation.
const MAX = 512
const LIFE = 7 // s
const HALF_W = 0.18
const ALPHA = 0.42

export class Skids {
  readonly mesh: THREE.Mesh
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly age: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly colAttr: THREE.BufferAttribute
  private cursor = 0

  constructor() {
    this.pos = new Float32Array(MAX * 4 * 3)
    this.col = new Float32Array(MAX * 4 * 4)
    this.age = new Float32Array(MAX).fill(LIFE)

    const idx = new Uint16Array(MAX * 6) // MAX*4 = 2048 verts, fits uint16
    for (let i = 0; i < MAX; i++) {
      const v = i * 4
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
    }
    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3)
    this.colAttr = new THREE.BufferAttribute(this.col, 4)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('color', this.colAttr)
    geo.setIndex(new THREE.BufferAttribute(idx, 1))

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0.95,
      }),
    )
    this.mesh.frustumCulled = false
  }

  // lay one quad from (x1,z1) to (x2,z2), flat on the ground above the road
  add(x1: number, z1: number, x2: number, z2: number) {
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    if (len < 1e-4) return
    const px = (-dz / len) * HALF_W
    const pz = (dx / len) * HALF_W

    const i = this.cursor
    this.cursor = (i + 1) % MAX
    this.age[i] = 0

    const p = i * 12
    const y = 0.055
    this.pos[p] = x1 + px
    this.pos[p + 1] = y
    this.pos[p + 2] = z1 + pz
    this.pos[p + 3] = x1 - px
    this.pos[p + 4] = y
    this.pos[p + 5] = z1 - pz
    this.pos[p + 6] = x2 - px
    this.pos[p + 7] = y
    this.pos[p + 8] = z2 - pz
    this.pos[p + 9] = x2 + px
    this.pos[p + 10] = y
    this.pos[p + 11] = z2 + pz

    const c = i * 16
    for (let v = 0; v < 4; v++) {
      this.col[c + v * 4] = 0.16
      this.col[c + v * 4 + 1] = 0.13
      this.col[c + v * 4 + 2] = 0.12
      this.col[c + v * 4 + 3] = ALPHA
    }
    this.posAttr.needsUpdate = true
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) continue
      this.age[i] += dt
      const a = this.age[i] >= LIFE ? 0 : ALPHA * (1 - this.age[i] / LIFE)
      const c = i * 16
      this.col[c + 3] = a
      this.col[c + 7] = a
      this.col[c + 11] = a
      this.col[c + 15] = a
    }
    this.colAttr.needsUpdate = true
  }
}
