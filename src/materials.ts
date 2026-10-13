import * as THREE from 'three'

// Shared PBR material factory — loads Poly Haven / ambientCG texture sets
// from public/textures and builds MeshStandard / Physical materials with
// correct color spaces and tiling. Falls back to procedural noise if a map
// is missing so the game still boots offline.

export type QualityLevel = 'high' | 'medium' | 'low'

export interface QualitySettings {
  level: QualityLevel
  pixelRatio: number
  shadowMapSize: number
  bloom: boolean
  ao: boolean
  envIntensity: number
  anisotropy: number
}

export function qualityFromPref(raw: string | null): QualityLevel {
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'high'
}

export function qualitySettings(level: QualityLevel): QualitySettings {
  switch (level) {
    case 'low':
      return {
        level,
        pixelRatio: 1,
        shadowMapSize: 1024,
        bloom: false,
        ao: false,
        envIntensity: 0.55,
        anisotropy: 2,
      }
    case 'medium':
      return {
        level,
        pixelRatio: Math.min(devicePixelRatio, 1.5),
        shadowMapSize: 2048,
        bloom: true,
        ao: false,
        envIntensity: 0.7,
        anisotropy: 4,
      }
    default:
      return {
        level: 'high',
        pixelRatio: Math.min(devicePixelRatio, 2),
        shadowMapSize: 2048,
        bloom: true,
        ao: true,
        envIntensity: 0.85,
        anisotropy: 8,
      }
  }
}

const loader = new THREE.TextureLoader()
const cache = new Map<string, THREE.Texture>()

function noiseCanvas(base = 128, variance = 18, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const img = g.createImageData(size, size)
  let seed = 1234567
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const v = base + ((seed >>> 8) % (variance * 2)) - variance
    img.data[i] = img.data[i + 1] = img.data[i + 2] = THREE.MathUtils.clamp(v, 0, 255)
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return canvas
}

function proceduralMap(base: number, variance: number, colorSpace: THREE.ColorSpace): THREE.Texture {
  const tex = new THREE.CanvasTexture(noiseCanvas(base, variance))
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = colorSpace
  return tex
}

function proceduralNormal(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const g = canvas.getContext('2d')!
  g.fillStyle = '#8080ff'
  g.fillRect(0, 0, 128, 128)
  // subtle grain so it isn't a flat blue slab
  const img = g.getImageData(0, 0, 128, 128)
  let seed = 42
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0
    img.data[i] = 128 + ((seed >>> 8) % 7) - 3
    img.data[i + 1] = 128 + ((seed >>> 16) % 7) - 3
    img.data[i + 2] = 255
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

async function loadMap(
  url: string,
  colorSpace: THREE.ColorSpace,
  anisotropy: number,
): Promise<THREE.Texture | null> {
  if (cache.has(url)) return cache.get(url)!
  try {
    const tex = await loader.loadAsync(url)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = colorSpace
    tex.anisotropy = anisotropy
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    cache.set(url, tex)
    return tex
  } catch {
    return null
  }
}

function tile(tex: THREE.Texture, rx: number, ry: number) {
  tex.repeat.set(rx, ry)
  tex.needsUpdate = true
  return tex
}

export interface PbrSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

export async function loadPbrSet(
  folder: string,
  prefix: string,
  anisotropy: number,
): Promise<PbrSet> {
  const base = `./textures/${folder}/${prefix}`
  const [diff, nor, rough] = await Promise.all([
    loadMap(`${base}_diff_1k.jpg`, THREE.SRGBColorSpace, anisotropy),
    loadMap(`${base}_nor_gl_1k.jpg`, THREE.NoColorSpace, anisotropy),
    loadMap(`${base}_rough_1k.jpg`, THREE.NoColorSpace, anisotropy),
  ])
  return {
    map: diff ?? proceduralMap(110, 22, THREE.SRGBColorSpace),
    normalMap: nor ?? proceduralNormal(),
    roughnessMap: rough ?? proceduralMap(160, 30, THREE.NoColorSpace),
  }
}

export function cloneTiled(set: PbrSet, rx: number, ry: number): PbrSet {
  return {
    map: tile(set.map.clone(), rx, ry),
    normalMap: tile(set.normalMap.clone(), rx, ry),
    roughnessMap: tile(set.roughnessMap.clone(), rx, ry),
  }
}

export function standardFromSet(
  set: PbrSet,
  opts: {
    color?: string | number
    roughness?: number
    metalness?: number
    normalScale?: number
  } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.color ?? '#ffffff',
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
  })
}

// Car paint — the single biggest "this is a real car" material cue on the web
export function carPaint(color: string | number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.72,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.15,
  })
}

export function carGlass(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#8ec8e8',
    metalness: 0,
    roughness: 0.05,
    transmission: 0.55,
    thickness: 0.35,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.4,
  })
}

export function carChrome(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#c8ccd2',
    metalness: 1,
    roughness: 0.18,
    envMapIntensity: 1.3,
  })
}

export function carRubber(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#1a1a1c',
    metalness: 0.05,
    roughness: 0.92,
  })
}

export function carDarkTrim(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#121214',
    metalness: 0.35,
    roughness: 0.55,
  })
}

// Convert a glTF MeshStandardMaterial into a more realistic car material by
// name heuristics (paint / glass / chrome / rubber / lights).
export function upgradeCarMaterial(
  mat: THREE.MeshStandardMaterial,
  recolor?: Record<string, string>,
): THREE.Material {
  const name = (mat.name || '').toLowerCase()
  const paint = recolor?.[mat.name]
  if (paint) {
    const m = carPaint(paint)
    m.name = mat.name
    return m
  }

  if (/glass|window|windshield|windscreen|transpar/.test(name)) {
    const m = carGlass()
    m.name = mat.name
    return m
  }
  if (/chrome|metal|mirror|trim|rim|hub|silver|steel/.test(name)) {
    const m = carChrome()
    m.name = mat.name
    if (mat.color) m.color.copy(mat.color)
    return m
  }
  if (/rubber|tire|tyre|wheel_black|black/.test(name) && !/body|paint/.test(name)) {
    const m = carRubber()
    m.name = mat.name
    return m
  }
  if (/light|lamp|head|tail|emissive|glow/.test(name)) {
    const m = new THREE.MeshStandardMaterial({
      color: mat.color?.clone() ?? new THREE.Color('#fff6d0'),
      emissive: mat.color?.clone() ?? new THREE.Color('#fff6d0'),
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.25,
    })
    m.name = mat.name
    return m
  }

  // default body paint: take existing color, add clearcoat
  if (!mat.map) mat.color.convertSRGBToLinear()
  const body = carPaint(mat.color.getHex())
  body.name = mat.name
  if (mat.map) {
    body.map = mat.map
    body.color.set('#ffffff')
  }
  body.roughness = Math.min(mat.roughness ?? 0.4, 0.35)
  body.metalness = Math.max(mat.metalness ?? 0.2, 0.55)
  return body
}

// World material pack loaded once at boot
export interface WorldMaterials {
  asphaltA: THREE.MeshStandardMaterial
  asphaltS: THREE.MeshStandardMaterial
  sidewalk: THREE.MeshStandardMaterial
  curb: THREE.MeshStandardMaterial
  ground: THREE.MeshStandardMaterial
  grass: THREE.MeshStandardMaterial
  buildings: THREE.MeshStandardMaterial[]
  roof: THREE.MeshStandardMaterial
  dash: THREE.MeshStandardMaterial
  yellowLine: THREE.MeshStandardMaterial
  crosswalk: THREE.MeshStandardMaterial
  windowDark: THREE.MeshPhysicalMaterial
  windowLit: THREE.MeshPhysicalMaterial
  metal: THREE.MeshStandardMaterial
  bark: THREE.MeshStandardMaterial
  foliage: THREE.MeshStandardMaterial
}

export async function loadWorldMaterials(anisotropy: number): Promise<WorldMaterials> {
  const [asphalt, concrete, brick, plaster, dirt, grass] = await Promise.all([
    loadPbrSet('asphalt', 'asphalt_02', anisotropy),
    loadPbrSet('concrete', 'concrete_floor', anisotropy),
    loadPbrSet('brick', 'brick_wall', anisotropy),
    loadPbrSet('plaster', 'plaster_wall', anisotropy),
    loadPbrSet('dirt', 'ground_dirt', anisotropy),
    loadPbrSet('dirt', 'grass_ground', anisotropy),
  ])

  const asphaltA = standardFromSet(cloneTiled(asphalt, 3, 90), {
    color: '#6a6e74',
    roughness: 0.95,
    normalScale: 0.7,
  })
  const asphaltS = standardFromSet(cloneTiled(asphalt, 90, 3), {
    color: '#6a6e74',
    roughness: 0.95,
    normalScale: 0.7,
  })
  const sidewalk = standardFromSet(cloneTiled(concrete, 40, 40), {
    color: '#c8c6bc',
    roughness: 0.92,
    normalScale: 0.55,
  })
  const curb = standardFromSet(cloneTiled(concrete, 8, 1), {
    color: '#d8d2c4',
    roughness: 0.88,
  })
  const ground = standardFromSet(cloneTiled(dirt, 80, 80), {
    color: '#c4a574',
    roughness: 0.97,
    normalScale: 0.8,
  })
  const grassMat = standardFromSet(cloneTiled(grass, 12, 12), {
    color: '#6f9a5a',
    roughness: 0.95,
    normalScale: 0.6,
  })

  const facadeColors = ['#c4a090', '#a89880', '#8a9098', '#b09078', '#7a8890', '#9a8a78', '#708090', '#b0a090']
  const buildings = facadeColors.map((c, i) => {
    const set = i % 2 === 0 ? brick : plaster
    return standardFromSet(cloneTiled(set, 2.5, 4), {
      color: c,
      roughness: 0.9,
      normalScale: 0.65,
    })
  })

  const roof = new THREE.MeshStandardMaterial({
    color: '#3a4048',
    roughness: 0.85,
    metalness: 0.15,
  })
  const dash = new THREE.MeshStandardMaterial({
    color: '#e8e4d8',
    roughness: 0.7,
    metalness: 0,
    emissive: '#1a1810',
    emissiveIntensity: 0.05,
  })
  const yellowLine = new THREE.MeshStandardMaterial({
    color: '#d4a820',
    roughness: 0.65,
    metalness: 0,
  })
  const crosswalk = new THREE.MeshStandardMaterial({
    color: '#ece6d8',
    roughness: 0.75,
  })
  const windowDark = new THREE.MeshPhysicalMaterial({
    color: '#1a2836',
    metalness: 0.85,
    roughness: 0.12,
    envMapIntensity: 1.2,
  })
  const windowLit = new THREE.MeshPhysicalMaterial({
    color: '#ffd27a',
    emissive: '#ffb84a',
    emissiveIntensity: 0.85,
    metalness: 0.2,
    roughness: 0.35,
  })
  const metal = new THREE.MeshStandardMaterial({
    color: '#5a6068',
    metalness: 0.75,
    roughness: 0.4,
  })
  const bark = new THREE.MeshStandardMaterial({ color: '#5a3a24', roughness: 0.95 })
  const foliage = new THREE.MeshStandardMaterial({ color: '#3d7a45', roughness: 0.9 })

  return {
    asphaltA,
    asphaltS,
    sidewalk,
    curb,
    ground,
    grass: grassMat,
    buildings,
    roof,
    dash,
    yellowLine,
    crosswalk,
    windowDark,
    windowLit,
    metal,
    bark,
    foliage,
  }
}
