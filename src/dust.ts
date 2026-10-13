import * as THREE from 'three'

// Pooled particle sprites — fixed-size buffers, zero per-frame allocation, one
// draw call. White tire smoke: soft round puffs that billow out, rise, grow as
// they thin, and fade — a tiny custom shader gives per-particle size + alpha.
const MAX = 420

// soft radial sprite so each particle is a blurry puff, not a hard pixel square
function smokeTexture(): THREE.Texture {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.4)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface DustOpts {
  color?: [number, number, number]
  rise?: number // m/s upward drift
  life?: number // s
  size?: number // base world size
  spread?: number // horizontal billow, m/s
}

export class Dust {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly aAlpha: Float32Array
  private readonly aSize: Float32Array
  private readonly age: Float32Array
  private readonly posAttr: THREE.BufferAttribute
  private readonly alphaAttr: THREE.BufferAttribute
  private readonly sizeAttr: THREE.BufferAttribute
  private readonly rise: number
  private readonly life: number
  private readonly baseSize: number
  private readonly spread: number
  private cursor = 0
  private debt = 0

  constructor(opts: DustOpts = {}) {
    const color = opts.color ?? [1, 1, 1]
    this.rise = opts.rise ?? 2.2
    this.life = opts.life ?? 1.1
    this.baseSize = opts.size ?? 1.6
    this.spread = opts.spread ?? 1.3
    this.pos = new Float32Array(MAX * 3)
    this.vel = new Float32Array(MAX * 3)
    this.aAlpha = new Float32Array(MAX)
    this.aSize = new Float32Array(MAX)
    this.age = new Float32Array(MAX).fill(this.life)

    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3)
    this.alphaAttr = new THREE.BufferAttribute(this.aAlpha, 1)
    this.sizeAttr = new THREE.BufferAttribute(this.aSize, 1)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aAlpha', this.alphaAttr)
    geo.setAttribute('aSize', this.sizeAttr)

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: smokeTexture() },
        uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  // rate-based emission (particles/second) so density is framerate-independent
  emitFrom(at: THREE.Vector3, rate: number, dt: number) {
    this.debt += rate * dt
    while (this.debt >= 1) {
      this.debt -= 1
      const i = this.cursor
      this.cursor = (i + 1) % MAX
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.35
      this.pos[i * 3 + 1] = at.y
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.35
      // billow outward + up so it plumes off the tire instead of a tight column
      const a = Math.random() * Math.PI * 2
      const s = Math.random() * this.spread
      this.vel[i * 3] = Math.cos(a) * s
      this.vel[i * 3 + 1] = this.rise * (0.6 + Math.random() * 0.6)
      this.vel[i * 3 + 2] = Math.sin(a) * s
      this.age[i] = 0
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life) {
        this.aAlpha[i] = 0
        continue
      }
      this.age[i] += dt
      const f = this.age[i] / this.life
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      this.aSize[i] = this.baseSize * (0.5 + f * 1.8) // grows as it dissipates
      this.aAlpha[i] = f < 0.15 ? (f / 0.15) * 0.7 : 0.7 * (1 - (f - 0.15) / 0.85) // quick fade in, slow out
    }
    this.posAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.sizeAttr.needsUpdate = true
  }
}
