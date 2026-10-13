import * as THREE from 'three'
import { initAudio, playImpact, playShift, setEngineLoop, setMuted, updateEngine } from './audio.ts'
import { Car } from './car.ts'
import { applyCarPreset, CARS, type CarDef } from './cars.ts'
import { ChaseCamera } from './camera.ts'
import { Dust } from './dust.ts'
import { readControls, type Controls } from './input.ts'
import { buildSky, HORIZON, loadOutdoorEnv } from './look.ts'
import { loadWorldMaterials, qualityFromPref, qualitySettings, type QualityLevel } from './materials.ts'
import { PostFX } from './postfx.ts'
import { Skids } from './skids.ts'
import { buildRoad, HighwayTraffic, ROAD_HALF } from './highway.ts'
import { TUNING as T } from './tuning.ts'

const IDLE: Controls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
  toggleGearbox: false,
}

// crash model: three good hits and you're wrecked; a brief i-frame window so one
// scrape doesn't chew the whole bar in a handful of contact frames.
const MAX_HP = 100
const HIT_DMG = 40
const INVULN = 1.0

// ---------- persistence (storage can be blocked — play without it) ----------
function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked */
  }
}

let best = Math.max(0, Math.floor(Number(loadPref('rr2.best')) || 0))

// ---------- quality ----------
let qualityLevel: QualityLevel = qualityFromPref(loadPref('rr1.quality'))
let quality = qualitySettings(qualityLevel)

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(quality.pixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.98
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(HORIZON, 220, 920)

{
  const outdoor = await loadOutdoorEnv(renderer, quality.envIntensity)
  if (outdoor) {
    scene.environment = outdoor.env
    scene.environmentIntensity = (outdoor.env.userData.intensity as number) ?? quality.envIntensity
  }
  if (outdoor?.background) {
    scene.background = outdoor.background // real photographed sky
    scene.fog!.color.set('#bcc6cc') // blend distance into the sky's horizon, not tan
  } else {
    scene.add(buildSky()) // painted fallback dome
  }
}

scene.add(new THREE.HemisphereLight('#c8d8e8', '#6a5a48', 0.45))
const sun = new THREE.DirectionalLight('#fff0d0', 2.7)
sun.castShadow = true
sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
const SHADOW_EXT = 90
sun.shadow.camera.left = -SHADOW_EXT
sun.shadow.camera.right = SHADOW_EXT
sun.shadow.camera.top = SHADOW_EXT
sun.shadow.camera.bottom = -SHADOW_EXT
sun.shadow.camera.near = 5
sun.shadow.camera.far = 280
sun.shadow.bias = -0.00025
sun.shadow.normalBias = 0.35
scene.add(sun, sun.target)

// ---------- the highway ----------
const worldMats = await loadWorldMaterials(quality.anisotropy)
const road = buildRoad(worldMats)
scene.add(road.group)
const traffic = new HighwayTraffic()
scene.add(traffic.group)
// solid guardrails: two long collision walls at the road edges that track the
// player, so the car scrapes along the barrier instead of leaving the asphalt.
// Same Obstacle type as traffic; appended past the traffic-owned indices.
const RAIL_X = ROAD_HALF + 1
const rails = [
  { x: -RAIL_X, z: 0, hw: 0.3, hd: 400 },
  { x: RAIL_X, z: 0, hw: 0.3, hd: 400 },
]
const obstacles = [...traffic.obstacles, ...rails]

// ---------- the car ----------
let carIndex = Math.max(0, CARS.findIndex((c) => c.id === loadPref('rr2.car')))
let currentCar: CarDef = CARS[carIndex]
applyCarPreset(currentCar)
const car = new Car()
car.setGears(currentCar.gears)
const savedGearMode = loadPref('rr1.gearMode')
if (savedGearMode === 'manual' || savedGearMode === 'auto') car.setGearMode(savedGearMode)
scene.add(car.mesh)
function loadCar(def: CarDef) {
  setEngineLoop(def.engine) // switch to this car's recorded engine loop
  car.configureWheels(def.spinWheels !== false, def.wheelAxis ?? 'x', def.wheelNodes)
  car.loadModel(def.model, def.recolor, def.id, def.glb, def.modelYaw).catch((e) =>
    console.warn('car model failed to load', e),
  )
}
loadCar(currentCar)
car.resetTo(0, 0, 0)
let heardShiftSerial = car.shiftSerial

// G cycles the garage — swaps model + handling + engine voice mid-drive
function selectCar(i: number) {
  carIndex = (i + CARS.length) % CARS.length
  currentCar = CARS[carIndex]
  applyCarPreset(currentCar)
  car.setGears(currentCar.gears)
  loadCar(currentCar)
  savePref('rr2.car', currentCar.id)
  showToast(`${currentCar.name} — ${currentCar.blurb}`)
}

const chase = new ChaseCamera(innerWidth / innerHeight)
chase.camera.position.set(0, T.camHeight, T.camDist)
const postfx = new PostFX(renderer, scene, chase.camera, quality)
postfx.setPixelRatio(quality.pixelRatio)

const skids = new Skids()
scene.add(skids.mesh)
const dust = new Dust()
scene.add(dust.points)
const dustL = new THREE.Vector3()
const dustR = new THREE.Vector3()
const prevL = new THREE.Vector3()
const prevR = new THREE.Vector3()
let skidActive = false

// ---------- run state ----------
let health = MAX_HP
let invuln = 0
let dead = false

function restart() {
  health = MAX_HP
  invuln = 0
  dead = false
  car.resetTo(0, 0, 0)
  chase.reset(0, 0)
  traffic.reset(0)
  skidActive = false
  bannerEl.textContent = ''
  msgEl.textContent = ''
}

function die() {
  dead = true
  const dist = Math.max(0, Math.floor(-car.z))
  if (dist > best) {
    best = dist
    savePref('rr2.best', String(best))
  }
  bannerEl.textContent = 'WRECKED'
  bannerEl.classList.remove('pop')
  void bannerEl.offsetWidth
  bannerEl.classList.add('pop')
  msgEl.textContent = `${dist} m · best ${best} m · R to run again`
}

function flashHit() {
  vignetteEl.classList.remove('hit')
  void vignetteEl.offsetWidth
  vignetteEl.classList.add('hit')
}

// ---------- settings ----------
let soundOn = loadPref('rr1.sound') !== 'off'
setMuted(!soundOn)

// ---------- title screen ----------
let titleOpen = true
const titleEl = document.getElementById('title')!
const btnSound = document.getElementById('btn-sound')!
const btnQuality = document.getElementById('btn-quality')!
const bestLine = document.getElementById('best-line')!

function syncSettingsUi() {
  btnSound.textContent = `sound: ${soundOn ? 'on' : 'off'}`
  btnQuality.textContent = `quality: ${qualityLevel}`
  bestLine.textContent = best > 0 ? `best run · ${best} m` : ''
}
syncSettingsUi()
if (matchMedia('(pointer: coarse)').matches) {
  document.getElementById('touch-note')!.hidden = false
}
btnSound.addEventListener('click', (e) => {
  e.stopPropagation()
  soundOn = !soundOn
  savePref('rr1.sound', soundOn ? 'on' : 'off')
  setMuted(!soundOn)
  syncSettingsUi()
})
btnQuality.addEventListener('click', (e) => {
  e.stopPropagation()
  qualityLevel = qualityLevel === 'high' ? 'medium' : qualityLevel === 'medium' ? 'low' : 'high'
  quality = qualitySettings(qualityLevel)
  savePref('rr1.quality', qualityLevel)
  renderer.setPixelRatio(quality.pixelRatio)
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
  if (sun.shadow.map) {
    sun.shadow.map.dispose()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sun.shadow as any).map = null
  }
  postfx.applyQuality(quality)
  postfx.setPixelRatio(quality.pixelRatio)
  postfx.setSize(innerWidth, innerHeight)
  scene.environmentIntensity = quality.envIntensity
  syncSettingsUi()
  showToast(`graphics: ${qualityLevel}`)
})

function closeTitle() {
  if (!titleOpen) return
  titleOpen = false
  titleEl.inert = true
  titleEl.classList.add('hidden')
  initAudio()
}
titleEl.addEventListener('click', closeTitle)

// ---------- global keys ----------
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (titleOpen) {
    closeTitle()
    return
  }
  if (e.code === 'KeyR') restart()
  else if (e.code === 'KeyG') selectCar(carIndex + 1)
})
addEventListener('keydown', initAudio)
addEventListener('pointerdown', initAudio)

// ---------- HUD ----------
const speedEl = document.getElementById('speed')!
const distEl = document.querySelector('#dist .m')!
const distBestEl = document.querySelector('#dist .best')!
const healthFill = document.getElementById('health-fill') as HTMLElement
const bannerEl = document.getElementById('banner')!
const msgEl = document.getElementById('msg')!
const toastEl = document.getElementById('toast')!
const vignetteEl = document.getElementById('vignette')!

let shownSpeed = -1
let shownGear = ''
let shownDist = -1
let shownHealth = -1
let contextLost = false

function showToast(text: string) {
  toastEl.textContent = text
  toastEl.classList.remove('show')
  void toastEl.offsetWidth
  toastEl.classList.add('show')
}

// ---------- game loop ----------
const FIXED_DT = 1 / 60
let accumulator = 0
let last = performance.now()

renderer.setAnimationLoop((now: number) => {
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.25) dt = 0.25

  const active = !titleOpen && !dead
  const controls = active ? readControls() : IDLE
  if (active) {
    if (controls.toggleGearbox) {
      const mode = car.toggleGearMode()
      savePref('rr1.gearMode', mode)
      showToast(`gearbox: ${mode === 'manual' ? 'manual Q/E' : 'automatic'}`)
    }
    if (controls.shiftDown && car.shiftDown()) showToast(`manual gear ${car.gear}/${car.gearCount}`)
    if (controls.shiftUp && car.shiftUp()) showToast(`manual gear ${car.gear}/${car.gearCount}`)
  }

  accumulator += dt
  while (accumulator >= FIXED_DT) {
    if (active) {
      traffic.step(FIXED_DT, car.z) // move traffic before the car reads obstacle positions
      rails[0].z = rails[1].z = car.z // keep the guardrail walls centred on the player
      car.surfaceGrip = Math.abs(car.x) < ROAD_HALF ? T.roadGrip : T.dirtGrip
      car.step(FIXED_DT, controls, obstacles)
      invuln = Math.max(0, invuln - FIXED_DT)
      if (car.impactImpulse > 2.5) {
        if (invuln === 0) {
          health -= HIT_DMG
          invuln = INVULN
          playImpact(1)
          flashHit()
          if (health <= 0) {
            health = 0
            die()
          }
        }
      }
    }
    accumulator -= FIXED_DT
  }
  const alpha = accumulator / FIXED_DT

  car.renderSync(alpha, dt)
  traffic.render(alpha)
  road.recenter(car.z)

  sun.position.set(car.mesh.position.x + 55, 95, car.mesh.position.z + 30)
  sun.target.position.set(car.mesh.position.x, 0, car.mesh.position.z)
  sun.target.updateMatrixWorld()

  const speedRatio = Math.min(1, car.speed / T.maxSpeed)
  chase.update(dt, car.mesh.position)

  // drift smoke + skid marks on high slip
  const slip = Math.abs(car.vL)
  const onRoad = Math.abs(car.x) < ROAD_HALF
  const sliding = active && (slip > 3.5 || (controls.handbrake && Math.abs(car.vF) > 3))
  if (sliding) {
    car.rearWheelWorld(-1, dustL)
    car.rearWheelWorld(1, dustR)
    const rate = onRoad ? 55 + slip * 7 : 85 + slip * 9 // thick tire smoke
    dust.emitFrom(dustL, rate, dt)
    dust.emitFrom(dustR, rate, dt)
    if (!skidActive) {
      skidActive = true
      prevL.copy(dustL)
      prevR.copy(dustR)
    } else if (prevL.distanceToSquared(dustL) > 0.3) {
      if (onRoad && slip > 4) {
        skids.add(prevL.x, prevL.z, dustL.x, dustL.z)
        skids.add(prevR.x, prevR.z, dustR.x, dustR.z)
      }
      prevL.copy(dustL)
      prevR.copy(dustR)
    }
  } else {
    skidActive = false
  }
  dust.update(dt)
  skids.update(dt)

  if (active && car.shiftSerial !== heardShiftSerial) {
    playShift(car.shiftDirection)
    heardShiftSerial = car.shiftSerial
  }
  if (active) {
    updateEngine(
      speedRatio,
      car.rpm,
      car.shifting,
      controls.throttle,
      Math.min(1, Math.abs(car.vL) / 12),
      currentCar.voice.pitch,
      currentCar.voice.growl,
    )
  } else {
    updateEngine(0, 0, false, 0, 0, currentCar.voice.pitch, currentCar.voice.growl) // spin the drone down
  }

  if (contextLost) {
    postfx.render()
    return
  }

  // HUD
  const kmh = Math.round(car.speed * 3.6)
  const gearLabel = Math.abs(car.vF) < 0.5 ? 'N' : car.vF < 0 ? 'R' : String(car.gear)
  const gearKey = `${car.gearMode}:${gearLabel}`
  if (kmh !== shownSpeed || gearKey !== shownGear) {
    shownSpeed = kmh
    shownGear = gearKey
    speedEl.textContent = `${car.gearMode === 'manual' ? 'M' : 'A'}${gearLabel} · ${kmh} km/h`
  }
  const dist = Math.max(0, Math.floor(-car.z))
  if (dist !== shownDist) {
    shownDist = dist
    distEl.textContent = `${dist} m`
    distBestEl.textContent = best > 0 ? `best ${best} m` : ''
  }
  if (health !== shownHealth) {
    shownHealth = health
    healthFill.style.width = `${health}%`
    healthFill.style.background =
      health > 60 ? 'linear-gradient(90deg,#4ad07a,#a6e05a)' : health > 30 ? 'linear-gradient(90deg,#ff5a3c,#ffd24a)' : '#ff3b2f'
  }

  postfx.render()
})

addEventListener('resize', () => {
  renderer.setPixelRatio(quality.pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  chase.camera.aspect = innerWidth / innerHeight
  chase.camera.updateProjectionMatrix()
  postfx.setSize(innerWidth, innerHeight)
  postfx.setPixelRatio(quality.pixelRatio)
})

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  contextLost = true
  bannerEl.textContent = 'Graphics hiccup — refresh the page'
})

// debug handles
Object.assign(window, {
  __car: car,
  __game: { renderer, scene, chase, traffic, road, postfx, dust, restart, die, showToast },
})
