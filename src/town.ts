import * as THREE from 'three'
import { glowMat, noiseTexture, toonMat } from './look.ts'
import type { Obstacle } from './car.ts'

// per-instance transforms collected while buildings are placed, then baked
// into a handful of InstancedMeshes — thousands of windows, one draw call each
interface Deco {
  windowsLit: THREE.Matrix4[]
  windowsDark: THREE.Matrix4[]
  pads: THREE.Matrix4[]
  antennas: THREE.Matrix4[]
  tanks: THREE.Matrix4[]
}
const _o = new THREE.Object3D()

function pushMatrix(list: THREE.Matrix4[]) {
  _o.updateMatrix()
  list.push(_o.matrix.clone())
}

export const CITY_ROAD_W = 16
export const CITY_AVENUES = [-240, -180, -120, -60, 0, 60, 120, 180, 240]
export const CITY_STREETS = [170, 110, 50, -10, -70, -130, -190, -250, -310]
export const CITY_BOUNDS = {
  minX: CITY_AVENUES[0] - 34,
  maxX: CITY_AVENUES[CITY_AVENUES.length - 1] + 34,
  minZ: CITY_STREETS[CITY_STREETS.length - 1] - 34,
  maxZ: CITY_STREETS[0] + 44,
}

// A chunky city built from readable primitives. Roads are intentionally wide:
// the car is fast, drifty, and forgiving delivery routes matter more than
// parking-lot precision.
export function buildTown(scene: THREE.Scene): Obstacle[] {
  const obstacles: Obstacle[] = []
  // tiled gray noise so the tarmac and pavement read as surfaces, not fills
  const asphaltTexA = noiseTexture(120, 16)
  asphaltTexA.repeat.set(3, 90)
  const asphaltTexS = noiseTexture(120, 16)
  asphaltTexS.repeat.set(90, 3)
  const concreteTex = noiseTexture(132, 9)
  concreteTex.repeat.set(110, 110)
  const roadMatA = toonMat('#3c4046', asphaltTexA, 0.95)
  const roadMatS = toonMat('#3c4046', asphaltTexS, 0.95)
  const dashMat = toonMat('#f0eadc')
  const sidewalkMat = toonMat('#bfc0b8', concreteTex, 0.9)
  const curbMat = toonMat('#e7d7bd')
  const buildingMats = [
    '#c96f4a',
    '#b5896a',
    '#8f7f5c',
    '#a0654f',
    '#7d6e8f',
    '#6e91a8',
    '#b7a05c',
    '#8a9a7d',
  ].map((c) => toonMat(c))

  const citySlab = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_BOUNDS.maxX - CITY_BOUNDS.minX, CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ),
    sidewalkMat,
  )
  citySlab.rotation.x = -Math.PI / 2
  citySlab.receiveShadow = true
  citySlab.position.set(
    (CITY_BOUNDS.minX + CITY_BOUNDS.maxX) / 2,
    0.011,
    (CITY_BOUNDS.minZ + CITY_BOUNDS.maxZ) / 2,
  )
  scene.add(citySlab)

  const deco: Deco = { windowsLit: [], windowsDark: [], pads: [], antennas: [], tanks: [] }

  buildRoadGrid(scene, roadMatA, roadMatS, dashMat, curbMat)
  buildCrosswalks(scene)
  buildBlocks(scene, obstacles, buildingMats, deco)
  buildDecoMeshes(scene, deco)
  buildPizzaShop(scene, obstacles)
  buildStreetFurniture(scene)
  buildSkyline(scene)

  return obstacles
}

// zebra stripes just outside every intersection, both crossing directions
function buildCrosswalks(scene: THREE.Scene) {
  const stripeGeo = new THREE.BoxGeometry(0.55, 0.02, 2.6)
  const stripes = new THREE.InstancedMesh(
    stripeGeo,
    toonMat('#e4ddc9'),
    CITY_AVENUES.length * CITY_STREETS.length * 40,
  )
  let n = 0
  for (const x of CITY_AVENUES) {
    for (const z of CITY_STREETS) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 10; i++) {
          // crossing the avenue: stripes step across x, long axis along z
          _o.position.set(x - 5.85 + i * 1.3, 0.075, z + side * 9.6)
          _o.rotation.set(0, 0, 0)
          _o.updateMatrix()
          stripes.setMatrixAt(n++, _o.matrix)
          // crossing the street: same geometry turned 90°
          _o.position.set(x + side * 9.6, 0.075, z - 5.85 + i * 1.3)
          _o.rotation.set(0, Math.PI / 2, 0)
          _o.updateMatrix()
          stripes.setMatrixAt(n++, _o.matrix)
        }
      }
    }
  }
  stripes.count = n
  scene.add(stripes)
}

// misty far-off skyline ring — fog does the coloring, depth cue for free
function buildSkyline(scene: THREE.Scene) {
  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#8f7b90' }),
    56,
  )
  for (let i = 0; i < towers.count; i++) {
    const a = (i / towers.count) * Math.PI * 2 + ((i * 7) % 5) * 0.05
    const r = 520 + ((i * 53) % 140)
    const w = 22 + ((i * 17) % 38)
    const h = 24 + ((i * 29) % 52)
    _o.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r)
    _o.rotation.set(0, a, 0)
    _o.scale.set(w, h, 20)
    _o.updateMatrix()
    towers.setMatrixAt(i, _o.matrix)
  }
  _o.scale.set(1, 1, 1)
  scene.add(towers)
}

function buildDecoMeshes(scene: THREE.Scene, deco: Deco) {
  const bake = (list: THREE.Matrix4[], geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) => {
    if (list.length === 0) return
    const im = new THREE.InstancedMesh(geo, mat, list.length)
    list.forEach((m, i) => im.setMatrixAt(i, m))
    im.castShadow = cast
    scene.add(im)
  }
  const windowGeo = new THREE.PlaneGeometry(1.15, 1.5)
  bake(deco.windowsDark, windowGeo, new THREE.MeshBasicMaterial({ color: '#26303c' }))
  bake(deco.windowsLit, windowGeo, new THREE.MeshBasicMaterial({ color: '#ffd27a' }))
  bake(
    deco.pads,
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.13, depthWrite: false }),
  )
  bake(deco.antennas, new THREE.CylinderGeometry(0.05, 0.09, 3.4, 6), toonMat('#3e4550'))
  bake(deco.tanks, new THREE.CylinderGeometry(1.0, 1.15, 1.9, 9), toonMat('#8c6f52'), true)
}

function buildRoadGrid(
  scene: THREE.Scene,
  roadMatA: THREE.Material,
  roadMatS: THREE.Material,
  dashMat: THREE.Material,
  curbMat: THREE.Material,
) {
  const lengthZ = CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ
  const lengthX = CITY_BOUNDS.maxX - CITY_BOUNDS.minX

  for (const x of CITY_AVENUES) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(CITY_ROAD_W, lengthZ), roadMatA)
    road.rotation.x = -Math.PI / 2
    road.position.set(x, 0.03, (CITY_BOUNDS.minZ + CITY_BOUNDS.maxZ) / 2)
    road.receiveShadow = true
    scene.add(road)

    // dash count derived from road length — hardcoding overruns onto the desert
    const dashCount = Math.floor((lengthZ - 22) / 11)
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.025, 4.3), dashMat, dashCount)
    const m = new THREE.Object3D()
    for (let i = 0; i < dashes.count; i++) {
      m.position.set(x, 0.06, CITY_BOUNDS.maxZ - 11 - i * 11)
      m.updateMatrix()
      dashes.setMatrixAt(i, m.matrix)
    }
    scene.add(dashes)
  }

  for (const z of CITY_STREETS) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(lengthX, CITY_ROAD_W), roadMatS)
    road.rotation.x = -Math.PI / 2
    road.position.set((CITY_BOUNDS.minX + CITY_BOUNDS.maxX) / 2, 0.04, z)
    road.receiveShadow = true
    scene.add(road)

    const dashCount = Math.floor((lengthX - 22) / 11)
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(4.3, 0.025, 0.45), dashMat, dashCount)
    const m = new THREE.Object3D()
    for (let i = 0; i < dashes.count; i++) {
      m.position.set(CITY_BOUNDS.minX + 11 + i * 11, 0.07, z)
      m.updateMatrix()
      dashes.setMatrixAt(i, m.matrix)
    }
    scene.add(dashes)
  }

  buildCurbs(scene, curbMat)
}

// curb segments that stop short of every intersection (and its crosswalk) —
// one instanced unit box, scaled per segment
function buildCurbs(scene: THREE.Scene, curbMat: THREE.Material) {
  const GAP = 11.2 // half-extent of intersection + crosswalk band
  const OFF = CITY_ROAD_W / 2 + 0.28
  const segs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), curbMat, 400)
  let n = 0
  const put = (x: number, z: number, lenX: number, lenZ: number) => {
    _o.position.set(x, 0.08, z)
    _o.rotation.set(0, 0, 0)
    _o.scale.set(lenX, 0.08, lenZ)
    _o.updateMatrix()
    segs.setMatrixAt(n++, _o.matrix)
  }

  const zSpans: [number, number][] = [[CITY_STREETS[0] + GAP, CITY_BOUNDS.maxZ]]
  for (let i = 0; i < CITY_STREETS.length - 1; i++) {
    zSpans.push([CITY_STREETS[i + 1] + GAP, CITY_STREETS[i] - GAP]) // streets descend
  }
  zSpans.push([CITY_BOUNDS.minZ, CITY_STREETS[CITY_STREETS.length - 1] - GAP])
  for (const x of CITY_AVENUES) {
    for (const side of [-1, 1]) {
      for (const [lo, hi] of zSpans) put(x + side * OFF, (lo + hi) / 2, 0.55, hi - lo)
    }
  }

  const xSpans: [number, number][] = [[CITY_BOUNDS.minX, CITY_AVENUES[0] - GAP]]
  for (let i = 0; i < CITY_AVENUES.length - 1; i++) {
    xSpans.push([CITY_AVENUES[i] + GAP, CITY_AVENUES[i + 1] - GAP])
  }
  xSpans.push([CITY_AVENUES[CITY_AVENUES.length - 1] + GAP, CITY_BOUNDS.maxX])
  for (const z of CITY_STREETS) {
    for (const side of [-1, 1]) {
      for (const [lo, hi] of xSpans) put((lo + hi) / 2, z + side * OFF, hi - lo, 0.55)
    }
  }

  segs.count = n
  _o.scale.set(1, 1, 1)
  scene.add(segs)
}

function buildBlocks(
  scene: THREE.Scene,
  obstacles: Obstacle[],
  mats: THREE.MeshStandardMaterial[],
  deco: Deco,
) {
  for (let ix = 0; ix < CITY_AVENUES.length - 1; ix++) {
    for (let iz = 0; iz < CITY_STREETS.length - 1; iz++) {
      const x1 = CITY_AVENUES[ix] + CITY_ROAD_W / 2
      const x2 = CITY_AVENUES[ix + 1] - CITY_ROAD_W / 2
      const zTop = CITY_STREETS[iz] - CITY_ROAD_W / 2
      const zBottom = CITY_STREETS[iz + 1] + CITY_ROAD_W / 2

      if (isPark(ix, iz)) {
        addPark(scene, x1, x2, zTop, zBottom, ix, iz)
      } else {
        addBlockBuildings(scene, obstacles, mats, deco, x1, x2, zTop, zBottom, ix, iz)
      }
    }
  }
}

function addBlockBuildings(
  scene: THREE.Scene,
  obstacles: Obstacle[],
  mats: THREE.MeshStandardMaterial[],
  deco: Deco,
  x1: number,
  x2: number,
  zTop: number,
  zBottom: number,
  ix: number,
  iz: number,
) {
  const blockW = x2 - x1
  const blockD = zTop - zBottom
  const lotW = blockW / 2
  const lotD = blockD / 2
  let local = 0

  for (let lx = 0; lx < 2; lx++) {
    for (let lz = 0; lz < 2; lz++) {
      const seed = ix * 41 + iz * 19 + lx * 7 + lz * 13
      if ((seed + ix + iz) % 7 === 0) continue

      const w = Math.min(lotW - 6, 10 + (seed % 9))
      const d = Math.min(lotD - 6, 10 + ((seed * 3) % 9))
      const tall = (ix === 4 || ix === 5) && iz > 1 && iz < 6
      const h = tall ? 16 + (seed % 19) : 5 + (seed % 10)
      const x = x1 + lotW * (lx + 0.5) + (((seed % 5) - 2) * 0.9)
      const z = zBottom + lotD * (lz + 0.5) + ((((seed >> 2) % 5) - 2) * 0.9)
      const mat = mats[(seed + local++) % mats.length]

      const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      building.position.set(x, h / 2, z)
      building.castShadow = true
      building.receiveShadow = true
      scene.add(building)
      obstacles.push({ x, z, hw: w / 2, hd: d / 2 })

      // setback tier on the tall towers — breaks the box silhouette
      if (tall && seed % 2 === 0) {
        const th = 3.5 + (seed % 5)
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, th, d * 0.62), mat)
        tier.position.set(x, h + th / 2, z)
        tier.castShadow = true
        scene.add(tier)
      }

      // fake contact AO: a soft dark pad under the footprint grounds the box
      _o.position.set(x, 0.05, z)
      _o.rotation.set(-Math.PI / 2, 0, 0)
      _o.scale.set(w + 2.4, d + 2.4, 1)
      pushMatrix(deco.pads)
      _o.scale.set(1, 1, 1)

      addBuildingWindows(deco, x, z, w, d, h, seed)
      addRoof(scene, deco, x, z, w, d, h, seed)
    }
  }
}

// window grids on all four faces — a third glow warm against the dusk
function addBuildingWindows(deco: Deco, x: number, z: number, w: number, d: number, h: number, seed: number) {
  for (let face = 0; face < 4; face++) {
    const along = face < 2 ? w : d // face 0/1: ±z normals, 2/3: ±x
    const cols = Math.floor((along - 2.0) / 2.2)
    if (cols <= 0) continue
    let floor = 0
    for (let fy = 2.1; fy < h - 1.1; fy += 2.7, floor++) {
      for (let i = 0; i < cols; i++) {
        const off = (i - (cols - 1) / 2) * 2.2
        if (face === 0) {
          _o.position.set(x + off, fy, z + d / 2 + 0.04)
          _o.rotation.set(0, 0, 0)
        } else if (face === 1) {
          _o.position.set(x + off, fy, z - d / 2 - 0.04)
          _o.rotation.set(0, Math.PI, 0)
        } else if (face === 2) {
          _o.position.set(x + w / 2 + 0.04, fy, z + off)
          _o.rotation.set(0, Math.PI / 2, 0)
        } else {
          _o.position.set(x - w / 2 - 0.04, fy, z + off)
          _o.rotation.set(0, -Math.PI / 2, 0)
        }
        const lit = (seed * 31 + face * 97 + floor * 57 + i * 13) % 100 < 32
        pushMatrix(lit ? deco.windowsLit : deco.windowsDark)
      }
    }
  }
}

function addRoof(
  scene: THREE.Scene,
  deco: Deco,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  seed: number,
) {
  if (h >= 8 && seed % 3 === 0) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.46, 0.35, d * 0.42),
      toonMat(seed % 2 === 0 ? '#4d5660' : '#725f57'),
    )
    roof.position.set(x, h + 0.18, z)
    scene.add(roof)
  }
  _o.rotation.set(0, 0, 0)
  if (h >= 14 && seed % 4 === 1) {
    _o.position.set(x + w * 0.2, h + 1.7, z - d * 0.15)
    pushMatrix(deco.antennas)
  }
  if (h >= 9 && seed % 5 === 0) {
    _o.position.set(x - w * 0.22, h + 0.95, z + d * 0.2)
    pushMatrix(deco.tanks)
  }
}

function isPark(ix: number, iz: number) {
  return (ix === 1 && iz === 4) || (ix === 6 && iz === 2) || (ix === 3 && iz === 6)
}

function addPark(
  scene: THREE.Scene,
  x1: number,
  x2: number,
  zTop: number,
  zBottom: number,
  ix: number,
  iz: number,
) {
  const park = new THREE.Mesh(
    new THREE.PlaneGeometry(x2 - x1 - 4, zTop - zBottom - 4),
    toonMat('#6aa36f'),
  )
  park.rotation.x = -Math.PI / 2
  park.receiveShadow = true
  park.position.set((x1 + x2) / 2, 0.055, (zTop + zBottom) / 2)
  scene.add(park)

  const trunk = toonMat('#7b4f34')
  const leaves = toonMat('#4e8d55')
  const tree = new THREE.Group()
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.8, 7), trunk)
  t.position.y = 0.9
  t.castShadow = true
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.6, 8), leaves)
  crown.position.y = 2.6
  crown.castShadow = true
  tree.add(t, crown)

  for (let i = 0; i < 10; i++) {
    const clone = tree.clone()
    const px = x1 + 8 + ((i * 11 + ix * 5) % Math.max(12, x2 - x1 - 16))
    const pz = zBottom + 8 + ((i * 13 + iz * 7) % Math.max(12, zTop - zBottom - 16))
    clone.position.set(px, 0, pz)
    clone.rotation.y = i * 0.9
    scene.add(clone)
  }
}

function buildPizzaShop(scene: THREE.Scene, obstacles: Obstacle[]) {
  const wall = toonMat('#f0c778')
  const roofMat = toonMat('#b8342e')
  const signMat = toonMat('#ff7f2a')
  const trimMat = toonMat('#fff4cf')

  const shop = new THREE.Mesh(new THREE.BoxGeometry(18, 4.2, 12), wall)
  shop.position.set(29, 2.1, 194)
  shop.castShadow = true
  scene.add(shop)
  obstacles.push({ x: 29, z: 194, hw: 9, hd: 6 })

  const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 1.1, 14), roofMat)
  roof.position.set(29, 4.75, 194)
  scene.add(roof)

  const awning = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.5, 2.2), signMat)
  awning.position.set(29, 3.1, 187.2)
  scene.add(awning)

  const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 1.8, 0.45), signMat)
  sign.position.set(29, 6.1, 187.4)
  scene.add(sign)

  const letters = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.32, 0.5), trimMat)
  letters.position.set(29, 6.13, 187.1)
  scene.add(letters)
}

function buildStreetFurniture(scene: THREE.Scene) {
  const poleMat = toonMat('#3e4550')
  // the bulb is self-lit and gets a fake volumetric cone + a pool of light
  // on the pavement — no real lights, no shadow maps, pure dusk vibes
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff1bd' })
  const m = new THREE.Object3D()
  const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 5.2, 8), poleMat, 96)
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), bulbMat, 96)
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.1, 4.6, 10, 1, true),
    glowMat('#ffdf9e', 0.08),
    96,
  )
  const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(3.6, 16), glowMat('#ffd98a', 0.07), 96)
  let n = 0

  for (let ia = 0; ia < CITY_AVENUES.length; ia++) {
    for (let is = 0; is < CITY_STREETS.length; is++) {
      // every other intersection by INDEX — street coords aren't multiples of
      // 60, so the old coordinate-parity test never passed (zero lamps)
      if ((ia + is) % 2 !== 0) continue
      if (n >= lamps.count) break
      const x = CITY_AVENUES[ia]
      const z = CITY_STREETS[is]
      m.position.set(x + CITY_ROAD_W / 2 + 2.8, 2.6, z + CITY_ROAD_W / 2 + 2.8)
      m.updateMatrix()
      lamps.setMatrixAt(n, m.matrix)
      m.position.y = 5.35
      m.updateMatrix()
      bulbs.setMatrixAt(n, m.matrix)
      m.position.y = 2.95
      m.updateMatrix()
      cones.setMatrixAt(n, m.matrix)
      m.position.y = 0.09
      m.rotation.x = -Math.PI / 2
      m.updateMatrix()
      pools.setMatrixAt(n, m.matrix)
      m.rotation.x = 0
      n++
    }
  }
  lamps.count = n
  bulbs.count = n
  cones.count = n
  pools.count = n
  scene.add(lamps, bulbs, cones, pools)
}
