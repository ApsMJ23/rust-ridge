import * as THREE from 'three'

// Material + sky helpers. toonMat kept as a name for call-site compatibility;
// it now returns PBR standard materials (the old toon gradient is gone).

export function toonMat(
  color: string | number,
  map: THREE.Texture | null = null,
  roughness = 0.85,
  metalness = 0.0,
) {
  return new THREE.MeshStandardMaterial({ color, map, roughness, metalness })
}

// tiling gray noise — fallback when PBR maps aren't loaded yet
export function noiseTexture(base = 128, variance = 14): THREE.Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const img = g.createImageData(size, size)
  let seed = 1234567
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const v = base + ((seed >>> 8) % (variance * 2)) - variance
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// additive self-lit material for light cones, pools and halos
export function glowMat(color: string | number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
}

// warm golden-hour palette — fog must match the horizon or the seam shows
export const HORIZON = '#d4b896'
export const ZENITH = '#4a7aa8'

// layered sky: high-res gradient dome + soft cloud cards + sun disc/halo
export function buildSky(): THREE.Group {
  const sky = new THREE.Group()

  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 512
  const g = canvas.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#1a3a62')
  grad.addColorStop(0.35, ZENITH)
  grad.addColorStop(0.62, '#8eb8c8')
  grad.addColorStop(0.82, '#e0c4a0')
  grad.addColorStop(1, HORIZON)
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 512)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  sky.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
    ),
  )

  // sun disc + multi-layer halo (low west for golden hour)
  const sunPos = new THREE.Vector3(0.78, 0.28, 0.45).normalize().multiplyScalar(820)
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(42, 48),
    new THREE.MeshBasicMaterial({ color: '#fff8e8', fog: false, depthWrite: false }),
  )
  sun.position.copy(sunPos)
  sun.lookAt(0, 0, 0)
  const halo = new THREE.Mesh(new THREE.CircleGeometry(120, 48), glowMat('#ffd0a0', 0.32))
  halo.position.copy(sunPos).multiplyScalar(0.99)
  halo.lookAt(0, 0, 0)
  const outer = new THREE.Mesh(new THREE.CircleGeometry(220, 48), glowMat('#ffb878', 0.12))
  outer.position.copy(sunPos).multiplyScalar(0.98)
  outer.lookAt(0, 0, 0)
  sky.add(sun, halo, outer)

  // soft cloud billboards — alpha-ish via basic material + flat scale
  const cloudMat = new THREE.MeshBasicMaterial({
    color: '#ffe8d8',
    transparent: true,
    opacity: 0.55,
    fog: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const cloudGeo = new THREE.PlaneGeometry(1, 1)
  for (let i = 0; i < 14; i++) {
    const a = i * 1.9 + 0.4
    const r = 420 + (i % 4) * 90
    const puff = new THREE.Mesh(cloudGeo, cloudMat)
    puff.position.set(Math.cos(a) * r, 90 + ((i * 29) % 100), Math.sin(a) * r)
    puff.scale.set(60 + ((i * 17) % 50), 18 + (i % 4) * 5, 1)
    puff.lookAt(0, puff.position.y, 0)
    sky.add(puff)
  }
  return sky
}

export function blobShadow(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false }),
  )
  m.rotation.x = -Math.PI / 2
  return m
}

// Outdoor HDRI: real sky background + IBL on paint/glass/metal. On success the
// caller gets both a PMREM env (reflections) and the raw equirect HDR (skybox);
// on failure it falls back to RoomEnvironment reflections and a null background
// (caller keeps the painted buildSky dome).
export interface OutdoorEnv {
  env: THREE.Texture
  background: THREE.Texture | null
}
export async function loadOutdoorEnv(
  renderer: THREE.WebGLRenderer,
  intensity = 0.85,
): Promise<OutdoorEnv | null> {
  try {
    const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js')
    const hdr = await new HDRLoader().loadAsync('./textures/hdri/kloppenheim_06_puresky_1k.hdr')
    hdr.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(hdr).texture
    pmrem.dispose()
    env.userData.intensity = intensity
    return { env, background: hdr } // keep the HDR alive as the visible sky
  } catch (e) {
    console.warn('HDRI load failed, falling back to RoomEnvironment', e)
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js')
      const pmrem = new THREE.PMREMGenerator(renderer)
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      env.userData.intensity = 0.45
      return { env, background: null }
    } catch {
      return null
    }
  }
}
