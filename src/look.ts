import * as THREE from 'three'

// Realistic pass: everything gets PBR standard materials — real shadows, ACES
// tone mapping and an environment map (set up in main.ts) do the actual work.
// The old name is kept because every module in the game imports it.
export function toonMat(
  color: string | number,
  map: THREE.Texture | null = null,
  roughness = 0.85,
  metalness = 0.0,
) {
  return new THREE.MeshStandardMaterial({ color, map, roughness, metalness })
}

// tiling gray noise — breaks up the big flat asphalt/concrete planes that
// scream "untextured" under realistic lighting
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
  return tex
}

// additive self-lit material for light cones, pools and halos. fog off:
// additive + fog would ADD horizon color per glow and wash the screen.
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

// warm dusk palette — fog must match the horizon or the seam shows
export const HORIZON = '#ffd9ab'
export const ZENITH = '#63bfd1'

// two-tone sky on an inverted dome (canvas gradient, no custom shader),
// plus a low dusk sun with a halo and a few flat toon clouds
export function buildSky(): THREE.Group {
  const sky = new THREE.Group()

  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const g = canvas.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, ZENITH)
  grad.addColorStop(0.6, '#a9d6cf')
  grad.addColorStop(1, HORIZON)
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace // else the horizon won't match the fog color
  sky.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
    ),
  )

  // sun: solid disc + additive halo, low over the west for the dusk drama.
  // buildings occlude it naturally via the depth buffer.
  const sunPos = new THREE.Vector3(0.82, 0.2, 0.4).normalize().multiplyScalar(820)
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(52, 40),
    new THREE.MeshBasicMaterial({ color: '#fff6d8', fog: false }),
  )
  sun.position.copy(sunPos)
  sun.lookAt(0, 0, 0)
  const halo = new THREE.Mesh(new THREE.CircleGeometry(150, 40), glowMat('#ffc98a', 0.35))
  halo.position.copy(sunPos).multiplyScalar(0.99)
  halo.lookAt(0, 0, 0)
  sky.add(sun, halo)

  // flat toon clouds: flattened spheres way out past the city, unlit
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffe8d0', fog: false })
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8)
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.7
    const r = 480 + (i % 3) * 110
    const puff = new THREE.Mesh(cloudGeo, cloudMat)
    puff.position.set(Math.cos(a) * r, 130 + ((i * 37) % 120), Math.sin(a) * r)
    puff.scale.set(26 + ((i * 13) % 22), 6 + (i % 3) * 2, 11 + ((i * 7) % 9))
    sky.add(puff)
  }
  return sky
}

// no shadow maps by design (the slowroads trick) — a blob grounds each car
export function blobShadow(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false }),
  )
  m.rotation.x = -Math.PI / 2
  return m
}
