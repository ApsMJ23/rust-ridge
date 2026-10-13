import * as THREE from 'three'
import { carChrome, carDarkTrim, carGlass, carPaint, carRubber } from './materials.ts'

// Procedural mid-poly vehicles with physical paint/glass/chrome.
// Used when a glTF fails, for traffic fleet, and as a consistent visual baseline.
// Each silhouette is distinct but shares the same material language.

export type VehicleKind =
  | 'pickup'
  | 'coupe'
  | 'sports'
  | 'van'
  | 'muscle'
  | 'hatch'
  | 'police'
  | 'truck'
  | 'formula'
  | 'sedan'

export interface VehicleSpec {
  kind: VehicleKind
  paint: string
  accent?: string
}

const WHEEL_R = 0.36
const WHEEL_W = 0.28

function wheelMesh(rubber: THREE.Material, rim: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  g.name = 'wheel'
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 20), rubber)
  tire.rotation.z = Math.PI / 2
  tire.castShadow = true
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, WHEEL_W * 1.05, 16), rim)
  disc.rotation.z = Math.PI / 2
  g.add(tire, disc)
  return g
}

function addWheels(body: THREE.Group, rubber: THREE.Material, rim: THREE.Material, track = 0.85, wb = 1.35) {
  const positions: [number, number, string][] = [
    [-track, -wb, 'wheel-front-left'],
    [track, -wb, 'wheel-front-right'],
    [-track, wb, 'wheel-rear-left'],
    [track, wb, 'wheel-rear-right'],
  ]
  for (const [x, z, name] of positions) {
    const w = wheelMesh(rubber, rim)
    w.name = name
    w.position.set(x, WHEEL_R, z)
    body.add(w)
  }
}

function cabinGlass(
  w: number,
  h: number,
  d: number,
  y: number,
  z: number,
  glass: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass)
  m.position.set(0, y, z)
  m.castShadow = true
  return m
}

function shadowCast(mesh: THREE.Object3D) {
  mesh.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
    }
  })
}

export function buildVehicle(spec: VehicleSpec): THREE.Group {
  const paint = carPaint(spec.paint)
  const accent = carPaint(spec.accent ?? '#1c1c20')
  const glass = carGlass()
  const chrome = carChrome()
  const rubber = carRubber()
  const trim = carDarkTrim()
  const body = new THREE.Group()
  body.name = `vehicle-${spec.kind}`

  switch (spec.kind) {
    case 'pickup': {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.55, 1.7), paint)
      bed.position.set(0, 0.72, 0.95)
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.7, 1.35), paint)
      cabin.position.set(0, 1.05, -0.55)
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.1), paint)
      hood.position.set(0, 0.78, -1.55)
      body.add(bed, cabin, hood, cabinGlass(1.55, 0.42, 1.05, 1.35, -0.45, glass))
      addWheels(body, rubber, chrome, 0.88, 1.4)
      break
    }
    case 'van': {
      const shell = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.55, 4.0), paint)
      shell.position.y = 1.15
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 0.7), paint)
      nose.position.set(0, 0.7, -1.85)
      body.add(shell, nose, cabinGlass(1.7, 0.7, 0.08, 1.45, -2.02, glass))
      addWheels(body, rubber, chrome, 0.9, 1.35)
      break
    }
    case 'coupe':
    case 'muscle': {
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.48, 4.1), paint)
      chassis.position.y = 0.55
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.5, 1.7), paint)
      cabin.position.set(0, 0.95, 0.15)
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 1.35), paint)
      hood.position.set(0, 0.72, -1.25)
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.25, 0.9), paint)
      trunk.position.set(0, 0.72, 1.55)
      body.add(chassis, cabin, hood, trunk, cabinGlass(1.5, 0.38, 1.45, 1.2, 0.1, glass))
      if (spec.kind === 'muscle') {
        const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.7), accent)
        scoop.position.set(0, 0.88, -1.1)
        body.add(scoop)
      }
      addWheels(body, rubber, chrome, 0.9, 1.4)
      break
    }
    case 'sports':
    case 'hatch': {
      const low = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.38, 4.0), paint)
      low.position.y = 0.48
      const wedge = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 2.2), paint)
      wedge.position.set(0, 0.78, 0.1)
      wedge.rotation.x = -0.08
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.2, 1.0), paint)
      nose.position.set(0, 0.55, -1.55)
      body.add(low, wedge, nose, cabinGlass(1.5, 0.32, 1.6, 0.98, 0.05, glass))
      addWheels(body, rubber, chrome, 0.92, 1.35)
      break
    }
    case 'police': {
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.5, 4.2), paint)
      chassis.position.y = 0.55
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.9), paint)
      cabin.position.set(0, 1.0, 0.1)
      const lightbar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.35), trim)
      lightbar.position.set(0, 1.4, -0.15)
      const blue = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.12, 0.3),
        new THREE.MeshStandardMaterial({ color: '#1a4cff', emissive: '#1a4cff', emissiveIntensity: 1.2 }),
      )
      blue.position.set(-0.28, 1.42, -0.15)
      const red = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.12, 0.3),
        new THREE.MeshStandardMaterial({ color: '#ff2222', emissive: '#ff2222', emissiveIntensity: 1.2 }),
      )
      red.position.set(0.28, 1.42, -0.15)
      body.add(chassis, cabin, lightbar, blue, red, cabinGlass(1.55, 0.4, 1.6, 1.22, 0.05, glass))
      addWheels(body, rubber, chrome, 0.9, 1.4)
      break
    }
    case 'truck': {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 1.8), paint)
      cab.position.set(0, 1.15, -1.0)
      const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.4, 2.4), accent)
      bodyBox.position.set(0, 1.3, 1.0)
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.35), chrome)
      bumper.position.set(0, 0.55, -1.95)
      body.add(cab, bodyBox, bumper, cabinGlass(1.85, 0.55, 0.1, 1.45, -1.9, glass))
      addWheels(body, rubber, chrome, 0.95, 1.45)
      break
    }
    case 'formula': {
      const mono = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 3.6), paint)
      mono.position.y = 0.4
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 1.2), paint)
      nose.position.set(0, 0.35, -2.0)
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), accent)
      wing.position.set(0, 0.75, 1.7)
      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.9), trim)
      cockpit.position.set(0, 0.65, -0.2)
      body.add(mono, nose, wing, cockpit)
      addWheels(body, rubber, chrome, 0.95, 1.25)
      break
    }
    default: {
      // sedan
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.2), paint)
      chassis.position.y = 0.55
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.52, 2.0), paint)
      cabin.position.set(0, 0.98, 0.05)
      body.add(chassis, cabin, cabinGlass(1.5, 0.4, 1.75, 1.2, 0.0, glass))
      addWheels(body, rubber, chrome, 0.88, 1.4)
    }
  }

  // headlights + taillights
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fff8e0',
    emissive: '#fff0c0',
    emissiveIntensity: 1.6,
    metalness: 0.3,
    roughness: 0.2,
  })
  const tailMat = new THREE.MeshStandardMaterial({
    color: '#ff2a22',
    emissive: '#ff1a12',
    emissiveIntensity: 1.1,
    metalness: 0.2,
    roughness: 0.3,
  })
  for (const sx of [-0.62, 0.62]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lampMat)
    lamp.position.set(sx, 0.58, -2.05)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.06), tailMat)
    tail.position.set(sx, 0.62, 2.05)
    body.add(lamp, tail)
  }

  shadowCast(body)
  return body
}

// Map roster car ids to procedural silhouettes + paints (used as fallback /
// when we force procedural mode for consistent realism).
export const CAR_VISUALS: Record<string, VehicleSpec> = {
  dusty: { kind: 'pickup', paint: '#d4783c' },
  jackal: { kind: 'muscle', paint: '#8b1e1e', accent: '#1a1a1a' },
  vesper: { kind: 'sports', paint: '#2a6a9a' },
  boxer: { kind: 'van', paint: '#e8d070' },
  sprinter: { kind: 'hatch', paint: '#3a8f6a' },
  nova: { kind: 'sports', paint: '#7b3cff', accent: '#1a1030' },
  interceptor: { kind: 'police', paint: '#f2f2f4', accent: '#1a1a22' },
  goliath: { kind: 'truck', paint: '#c43a2a', accent: '#f0f0f0' },
  formula: { kind: 'formula', paint: '#c8231a', accent: '#f2f2f4' },
}

export function buildCarForId(id: string): THREE.Group {
  return buildVehicle(CAR_VISUALS[id] ?? { kind: 'sedan', paint: '#c07040' })
}

export function trafficPalette(): string[] {
  return ['#c44536', '#2f5f8f', '#c9a23c', '#3d7a52', '#6b4f8a', '#b8b0a4', '#2c333d', '#8a5a3a']
}
