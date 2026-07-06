import * as THREE from 'three'
import { honk, initAudio, playImpact, playShift, setMuted, updateEngine } from './audio.ts'
import { Car } from './car.ts'
import { applyCarPreset, CARS, unlockedCars, type CarDef } from './cars.ts'
import { ChaseCamera } from './camera.ts'
import { Dust } from './dust.ts'
import { readControls, type Controls } from './input.ts'
import { buildSky, HORIZON, noiseTexture, toonMat } from './look.ts'
import { MissionManager, type GameState } from './mission.ts'
import { MISSIONS } from './missions.ts'
import { Minimap } from './minimap.ts'
import { Npc } from './npc.ts'
import { Peds } from './peds.ts'
import { Props } from './props.ts'
import { Skids } from './skids.ts'
import { buildTown } from './town.ts'
import { Traffic } from './traffic.ts'
import { initTuningPanel, TUNING as T } from './tuning.ts'

const SPAWN = { x: 0, z: 205, heading: 0 } // outside Pizza HQ, facing into the city
const IDLE: Controls = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
  toggleGearbox: false,
}

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

function loadSave(): { completed: Record<string, number>; car: string } {
  try {
    const raw = loadPref('rr1.save')
    if (raw) {
      const s = JSON.parse(raw)
      if (s && typeof s.completed === 'object' && s.completed !== null) {
        // keep only sane best times — corrupt values would poison record
        // tracking and unlock gating forever, since they round-trip each save
        const completed: Record<string, number> = {}
        for (const [k, v] of Object.entries(s.completed)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) completed[k] = v
        }
        return { completed, car: String(s.car ?? 'dusty') }
      }
    }
  } catch {
    /* corrupt save — start fresh */
  }
  return { completed: {}, car: 'dusty' }
}
const save = loadSave()

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
// realistic pass: filmic tone mapping + real shadow maps
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.28
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(HORIZON, 180, 850)
scene.add(buildSky())

// neutral studio environment gives the PBR materials something to reflect
{
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js')
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.45
  pmrem.dispose()
}

scene.add(new THREE.HemisphereLight('#ffe9cf', '#b08a5e', 0.75))
const sun = new THREE.DirectionalLight('#ffd9a0', 3.6)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -110
sun.shadow.camera.right = 110
sun.shadow.camera.top = 110
sun.shadow.camera.bottom = -110
sun.shadow.camera.near = 10
sun.shadow.camera.far = 400
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.6
scene.add(sun, sun.target)

const groundTex = noiseTexture(126, 12)
groundTex.repeat.set(160, 160)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), toonMat('#d6bf8b', groundTex, 0.95))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// scrub outside the city for motion cues - instanced, one draw call
{
  const rocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toonMat('#c9a06b'), 150)
  rocks.castShadow = true
  rocks.receiveShadow = true
  const m = new THREE.Object3D()
  for (let i = 0; i < rocks.count; i++) {
    do {
      m.position.set((Math.random() - 0.5) * 800, 0, (Math.random() - 0.5) * 800)
    } while (Math.abs(m.position.x) < 305 && m.position.z < 235 && m.position.z > -360)
    const s = 0.5 + Math.random() * 1.5
    m.scale.set(s, s * 0.6, s)
    m.position.y = s * 0.3
    m.rotation.y = Math.random() * Math.PI
    m.updateMatrix()
    rocks.setMatrixAt(i, m.matrix)
  }
  scene.add(rocks)

  // a ring of cones beside the pickup bay
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 1, 8), toonMat('#ff7f2a'), 8)
  m.rotation.y = 0
  m.scale.set(1, 1, 1)
  for (let i = 0; i < cones.count; i++) {
    const a = (i / cones.count) * Math.PI * 2
    m.position.set(-36 + Math.sin(a) * 12, 0.5, 192 + Math.cos(a) * 12)
    m.updateMatrix()
    cones.setMatrixAt(i, m.matrix)
  }
  scene.add(cones)
}

const obstacles = buildTown(scene)
const missions = new MissionManager(MISSIONS, save.completed)
scene.add(missions.group)

// the living city: traffic you can crash into, pedestrians who bail out of
// the way, and street clutter that goes flying.
// props first: it filters against building footprints, so the obstacles array
// must not contain the (moving) traffic entries yet
const props = new Props(obstacles)
props.onImpact = (intensity) => playImpact(intensity)
scene.add(props.group)
const traffic = new Traffic()
obstacles.push(...traffic.obstacles) // traffic mutates these in place each step
scene.add(traffic.group)
const peds = new Peds()
scene.add(peds.group)

// Mabel, parked by Pizza HQ facing the road
const npc = new Npc(11, 193, Math.PI / 2)
npc.load('./npc.glb').catch((e) => console.warn('npc model failed to load', e))
scene.add(npc.mesh)

// ---------- the car + roster ----------
let currentCar: CarDef =
  unlockedCars(missions.completed).find((c) => c.id === save.car) ?? CARS[0]
applyCarPreset(currentCar)

// headlamp dots + tail lights, on the group so it survives model swaps.
// No beams and no ground pool: warm additive glow on daylit tarmac reads as
// a brown stain from the chase camera, not as light. Streetlights keep their
// pools because a glow under a lamp has context; one under a moving car doesn't.
function buildCarLights(): THREE.Group {
  const g = new THREE.Group()
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6d0' })
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff3b2e' })
  for (const sx of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lampMat)
    lamp.position.set(sx, 0.6, -2.02)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.06), tailMat)
    tail.position.set(sx, 0.6, 2.02)
    g.add(lamp, tail)
  }
  return g
}

const car = new Car()
car.mesh.add(buildCarLights())
car.setGears(currentCar.gears)
const savedGearMode = loadPref('rr1.gearMode')
if (savedGearMode === 'manual' || savedGearMode === 'auto') car.setGearMode(savedGearMode)
scene.add(car.mesh)
car.loadModel(currentCar.model, currentCar.recolor).catch((e) => console.warn('car model failed to load, keeping the box', e))
car.resetTo(SPAWN.x, SPAWN.z, SPAWN.heading)
let heardShiftSerial = car.shiftSerial
const chase = new ChaseCamera(innerWidth / innerHeight)
chase.camera.position.set(SPAWN.x, T.camHeight, SPAWN.z + T.camDist)

const dust = new Dust()
scene.add(dust.points)
const dustL = new THREE.Vector3()
const dustR = new THREE.Vector3()
const skids = new Skids()
scene.add(skids.mesh)
const prevL = new THREE.Vector3()
const prevR = new THREE.Vector3()
let skidActive = false

function persistSave() {
  savePref('rr1.save', JSON.stringify({ v: 1, completed: missions.completed, car: currentCar.id }))
}

function selectCar(def: CarDef) {
  currentCar = def
  applyCarPreset(def)
  car.setGears(def.gears)
  car.loadModel(def.model, def.recolor).catch((e) => console.warn('car model failed to load', e))
  persistSave()
  showToast(`${def.name} — ${def.blurb}`)
}

// ---------- settings ----------
let soundOn = loadPref('rr1.sound') !== 'off'
let motionFull = loadPref('rr1.motion') !== 'reduced'
setMuted(!soundOn)
T.fovKick = motionFull ? 8 : 0

// ---------- title screen ----------
let titleOpen = true
const titleEl = document.getElementById('title')!
const btnSound = document.getElementById('btn-sound')!
const btnMotion = document.getElementById('btn-motion')!
const bestLine = document.getElementById('best-line')!

function syncSettingsUi() {
  btnSound.textContent = `sound: ${soundOn ? 'on' : 'off'}`
  btnMotion.textContent = `camera motion: ${motionFull ? 'full' : 'reduced'}`
  const done = Object.keys(missions.completed).length
  bestLine.textContent = done > 0 ? `${done}/${MISSIONS.length} jobs done` : ''
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
btnMotion.addEventListener('click', (e) => {
  e.stopPropagation()
  motionFull = !motionFull
  savePref('rr1.motion', motionFull ? 'full' : 'reduced')
  T.fovKick = motionFull ? 8 : 0
  syncSettingsUi()
})

function closeTitle() {
  if (!titleOpen) return
  titleOpen = false
  titleEl.inert = true // blur + drop the settings buttons from focus/tab order
  titleEl.classList.add('hidden')
  initAudio() // we are inside a user gesture here
}
titleEl.addEventListener('click', closeTitle)

// ---------- global keys ----------
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (titleOpen) {
    closeTitle()
    return
  }
  if (e.code === 'KeyR') {
    const pose = missions.retry() ?? SPAWN // retry the run, or just respawn in free roam
    car.resetTo(pose.x, pose.z, pose.heading)
    chase.camera.position.set(
      pose.x + Math.sin(pose.heading) * T.camDist,
      T.camHeight,
      pose.z + Math.cos(pose.heading) * T.camDist,
    )
    skidActive = false // else stale prev points draw a skid streak across the map
    lastState = missions.state
    goTimer = missions.state === 'running' ? 1.0 : 0
    briefTimer = missions.state === 'running' ? 5 : 0
  } else if (e.code === 'KeyG') {
    const list = unlockedCars(missions.completed)
    if (list.length < 2) {
      showToast(`${currentCar.name} is your only ride — win jobs to unlock more`)
    } else {
      selectCar(list[(list.findIndex((c) => c.id === currentCar.id) + 1) % list.length])
    }
  } else if (e.code === 'KeyH') {
    honk()
    peds.reactHonk(car.x, car.z)
  }
})
// AudioContext needs a real activation; keep retrying on gestures (Escape
// as the very first key would otherwise latch it suspended)
addEventListener('keydown', initAudio)
addEventListener('pointerdown', initAudio)

initTuningPanel().catch((e) => console.warn('tuning panel unavailable', e))

// ---------- HUD ----------
const speedEl = document.getElementById('speed')!
const timerEl = document.getElementById('timer')!
const bannerEl = document.getElementById('banner')!
const msgEl = document.getElementById('msg')!
const objectiveEl = document.getElementById('objective')!
const bubbleEl = document.getElementById('bubble')!
const toastEl = document.getElementById('toast')!
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, MISSIONS)

let shownSpeed = -1
let shownGear = ''
let shownTimer = -2
let hudTitle = !titleOpen // deliberately stale so the first syncHud paints
let hudState: GameState = missions.state
let hudMission = ''
let hudGo = false
let hudBrief = false
let objKey = ' ' // stale so the first syncHud paints
let shownStrikes = 0
let shownSmashed = 0
let lastState: GameState = missions.state
let goTimer = 0
let briefTimer = 0
let contextLost = false
const vignetteEl = document.getElementById('vignette')!

function showToast(text: string) {
  toastEl.textContent = text
  toastEl.classList.remove('show')
  void toastEl.offsetWidth // restart the animation
  toastEl.classList.add('show')
}

function syncHud() {
  if (contextLost) return // don't clobber the context-lost message
  const st = missions.state
  const def = missions.active
  const id = def ? def.id : ''
  const go = goTimer > 0
  const brief = briefTimer > 0

  if (titleOpen !== hudTitle || st !== hudState || id !== hudMission || go !== hudGo || brief !== hudBrief) {
    hudTitle = titleOpen
    hudState = st
    hudMission = id
    hudGo = go
    hudBrief = brief
    let banner = ''
    let msg = ''
    if (!titleOpen) {
      if (st === 'idle') {
        msg = 'Drive into a glowing marker to start a job · G swaps cars'
      } else if (st === 'running' && def) {
        banner = go ? 'GO!' : ''
        msg = brief ? `“${def.brief}”` : ''
      } else if (st === 'won' && def) {
        banner = 'Nailed it!'
        msg = `“${def.winLine}” · ${missions.elapsed.toFixed(1)}s${
          missions.lastWinWasRecord ? ' · NEW RECORD!' : ''
        } · R reruns it`
      } else if (st === 'lost' && def) {
        banner = 'Out of time!'
        msg = `“${def.loseLine}” · R retries`
      }
    }
    bannerEl.textContent = banner
    msgEl.textContent = msg
    if (banner) {
      bannerEl.classList.remove('pop')
      void bannerEl.offsetWidth
      bannerEl.classList.add('pop')
    }
  }

  const t = st === 'running' ? Math.ceil(missions.timeLeft) : -1
  if (t !== shownTimer) {
    shownTimer = t
    timerEl.textContent = t >= 0 ? String(t) : ''
    timerEl.style.color = t >= 0 && t <= 10 ? '#ff6b57' : '#ffffff'
  }

  const key =
    st === 'running' && def
      ? `${id}:${missions.index}:${missions.collected}:${missions.rivalIndex}:${missions.strikes}:${missions.smashed}`
      : ''
  if (key !== objKey) {
    objKey = key
    if (!key || !def) {
      objectiveEl.textContent = ''
    } else {
      const obj = def.objective
      if (obj.type === 'checkpoints') {
        objectiveEl.textContent = `${def.title} · ${missions.index}/${obj.route.length} deliveries`
      } else if (obj.type === 'race') {
        objectiveEl.textContent = `${def.title} · you ${missions.index}/${obj.route.length} · rival ${missions.rivalIndex}/${obj.route.length}`
      } else if (obj.type === 'escape') {
        const hearts = '❤'.repeat(3 - missions.strikes) + '♡'.repeat(missions.strikes)
        objectiveEl.textContent = `${def.title} · ${hearts} · reach the shop`
      } else if (obj.type === 'smash') {
        objectiveEl.textContent = `${def.title} · ${missions.smashed}/${obj.targets.length} smashed`
      } else {
        objectiveEl.textContent = `${def.title} · ${missions.collected}/${obj.items.length}`
      }
    }
  }
}

// Dispatcher's speech bubble, projected from her roof (free roam only)
const bubblePos = new THREE.Vector3()
let bubbleShown = false
let bubbleX = -1
let bubbleY = -1
let bubbleOp = ''
function setBubbleOpacity(o: string) {
  if (bubbleOp !== o) {
    bubbleOp = o
    bubbleEl.style.opacity = o
  }
}
function syncBubble() {
  const show = !titleOpen && missions.state === 'idle'
  if (show !== bubbleShown) {
    bubbleShown = show
    bubbleEl.hidden = !show
  }
  if (!show) return
  npc.bubbleAnchor.getWorldPosition(bubblePos)
  if (bubblePos.distanceTo(chase.camera.position) > 55) {
    setBubbleOpacity('0')
    return
  }
  bubblePos.project(chase.camera)
  if (bubblePos.z > 1) {
    setBubbleOpacity('0')
    return
  }
  setBubbleOpacity('1')
  // write styles only on change — this runs every rendered frame
  const x = Math.round((bubblePos.x * 0.5 + 0.5) * innerWidth)
  const y = Math.round((-bubblePos.y * 0.5 + 0.5) * innerHeight)
  if (x !== bubbleX) {
    bubbleX = x
    bubbleEl.style.left = `${x}px`
  }
  if (y !== bubbleY) {
    bubbleY = y
    bubbleEl.style.top = `${y}px`
  }
}

// ---------- game loop ----------
// fixed-timestep physics with render interpolation: handling is identical
// at any framerate, and the render never shows a raw 60Hz stutter
const FIXED_DT = 1 / 60
let accumulator = 0
let last = performance.now()

renderer.setAnimationLoop((now: number) => {
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.25) dt = 0.25 // backgrounded tab: cap catch-up, no death spiral

  const controls = titleOpen ? IDLE : readControls()
  if (!titleOpen) {
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
    traffic.step(FIXED_DT, car.x, car.z) // first: obstacles current before the car moves
    car.step(FIXED_DT, controls, obstacles)
    // in the fixed loop: a hitch frame moves the car ~10m — sampled per frame,
    // that can jump clean over a ring's 5m pass zone; per substep it's ≤0.7m
    missions.update(FIXED_DT, car.x, car.z)
    peds.step(FIXED_DT, car.x, car.z, car.vx, car.vz)
    props.step(FIXED_DT, car.x, car.z, car.vx, car.vz)
    accumulator -= FIXED_DT
  }

  // escape-mission hits: red flash + thud + a heart gone
  if (missions.strikes !== shownStrikes) {
    if (missions.strikes > shownStrikes && missions.state !== 'idle') {
      playImpact(1)
      vignetteEl.classList.remove('hit')
      void vignetteEl.offsetWidth
      vignetteEl.classList.add('hit')
      if (missions.strikes < 3) {
        showToast(`They rammed the stack! ${'❤'.repeat(3 - missions.strikes)} left`)
      }
    }
    shownStrikes = missions.strikes
  }
  // crate crunch
  if (missions.smashed !== shownSmashed) {
    if (missions.smashed > shownSmashed) playImpact(0.85)
    shownSmashed = missions.smashed
  }

  if (missions.state !== lastState) {
    if (missions.state === 'running') {
      goTimer = 1.0
      briefTimer = 5
    }
    if (missions.state === 'won' && missions.active) {
      persistSave()
      syncSettingsUi()
      if (missions.lastWinWasFirst) {
        const unlocked = CARS.find((c) => c.unlockedBy === missions.active!.id)
        if (unlocked) showToast(`🔓 ${unlocked.name} unlocked — press G to drive it`)
      }
    }
    lastState = missions.state
  }
  if (goTimer > 0) goTimer -= dt
  if (briefTimer > 0) briefTimer -= dt

  car.renderSync(accumulator / FIXED_DT, dt)
  traffic.render(accumulator / FIXED_DT, dt)
  peds.render()
  // the shadow camera is a 220m box — keep it centered on the action
  sun.position.set(car.mesh.position.x + 60, 90, car.mesh.position.z + 25)
  sun.target.position.set(car.mesh.position.x, 0, car.mesh.position.z)
  const speedRatio = Math.min(1, car.speed / T.maxSpeed)
  // drift cam: hang behind the velocity vector while the rear is out
  const velHeading = car.speed > 2 ? Math.atan2(-car.vx, -car.vz) : car.visHeading
  const driftBlend = motionFull ? Math.min(0.55, Math.abs(car.vL) / 14) : 0
  chase.update(dt, car.mesh.position, car.visHeading, speedRatio, velHeading, driftBlend)

  // dust + skid marks while the rear is loose (or handbrake dragging at speed)
  const sliding = Math.abs(car.vL) > 4 || (controls.handbrake && Math.abs(car.vF) > 3)
  if (sliding) {
    car.rearWheelWorld(-1, dustL)
    car.rearWheelWorld(1, dustR)
    dust.emitFrom(dustL, 35, dt)
    dust.emitFrom(dustR, 35, dt)
    if (!skidActive) {
      skidActive = true
      prevL.copy(dustL)
      prevR.copy(dustR)
    } else if (prevL.distanceToSquared(dustL) > 0.36) {
      skids.add(prevL.x, prevL.z, dustL.x, dustL.z)
      skids.add(prevR.x, prevR.z, dustR.x, dustR.z)
      prevL.copy(dustL)
      prevR.copy(dustR)
    }
  } else {
    skidActive = false
  }
  dust.update(dt)
  skids.update(dt)
  if (!titleOpen && car.shiftSerial !== heardShiftSerial) {
    playShift(car.shiftDirection)
    heardShiftSerial = car.shiftSerial
  }
  if (!titleOpen) {
    updateEngine(
      speedRatio,
      car.rpm,
      car.shifting,
      controls.throttle,
      Math.min(1, Math.abs(car.vL) / 12),
      currentCar.voice.pitch,
      currentCar.voice.growl,
    )
  } // silent under the title
  syncHud()

  const kmh = Math.round(car.speed * 3.6)
  const gearLabel = Math.abs(car.vF) < 0.5 ? 'N' : car.vF < 0 ? 'R' : String(car.gear)
  const gearKey = `${car.gearMode}:${gearLabel}` // compare what we store, or this rewrites every frame
  if (kmh !== shownSpeed || gearKey !== shownGear) {
    shownSpeed = kmh
    shownGear = gearKey
    speedEl.textContent = `${car.gearMode === 'manual' ? 'M' : 'A'}${gearLabel} · ${kmh} km/h`
  }
  minimap.draw(car, missions, titleOpen)

  renderer.render(scene, chase.camera)
  syncBubble() // after render: project() then uses this frame's camera matrices
})

addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)) // dPR changes when moving between displays or zooming
  renderer.setSize(innerWidth, innerHeight)
  chase.camera.aspect = innerWidth / innerHeight
  chase.camera.updateProjectionMatrix()
})

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  contextLost = true
  bannerEl.textContent = 'Graphics hiccup — refresh the page'
})

// debug handles for poking at the game from the console
Object.assign(window, {
  __car: car,
  __readControls: readControls,
  __game: { renderer, scene, chase, dust, skids, missions, minimap, npc, obstacles, traffic, peds, props, syncHud, syncBubble, closeTitle, showToast },
})
