// Audio is WebAudio: each car plays its own real recorded engine loop (CC0),
// with synthesized tire scrub, shifts, wind, and horn. initAudio must run from
// user gestures; call it from every gesture until the context actually resumes.
let ctx: AudioContext | null = null
let master: GainNode
let sampleFilter: BiquadFilterNode // tone-shapes the recorded engine loop
let sampleGain: GainNode
let engineSrc: AudioBufferSourceNode | null = null // the current looping engine recording
let engineUrl = './ferrari_engine.wav' // per-car loop; set via setEngineLoop before/after init
const engineBuffers = new Map<string, AudioBuffer>() // decoded loops, cached across swaps
let scrubGain: GainNode
let windGain: GainNode | null = null
let muted = false

export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)

    // per-car recorded engine loop (CC0, OpenGameArt); playbackRate tracks rpm
    sampleFilter = ctx.createBiquadFilter()
    sampleFilter.type = 'lowpass'
    sampleFilter.frequency.value = 900
    sampleGain = ctx.createGain()
    sampleGain.gain.value = 0
    sampleFilter.connect(sampleGain)
    sampleGain.connect(master)
    startEngine(engineUrl)

    scrubGain = ctx.createGain()
    scrubGain.gain.value = 0
    const scrubFilter = ctx.createBiquadFilter()
    scrubFilter.type = 'bandpass'
    scrubFilter.frequency.value = 1350
    scrubFilter.Q.value = 0.9
    const scrub = ctx.createBufferSource()
    scrub.buffer = makeNoiseBuffer(ctx)
    scrub.loop = true
    scrub.connect(scrubFilter)
    scrubFilter.connect(scrubGain)
    scrubGain.connect(master)
    scrub.start()

    // wind rush at speed
    windGain = ctx.createGain()
    windGain.gain.value = 0
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'highpass'
    windFilter.frequency.value = 400
    const wind = ctx.createBufferSource()
    wind.buffer = makeNoiseBuffer(ctx)
    wind.loop = true
    wind.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(master)
    wind.start()

    // rAF stops in hidden tabs but WebAudio does not, so silence the drone.
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return
      if (document.hidden) void ctx.suspend()
      else void ctx.resume()
    })
  }
  if (ctx.state === 'suspended' && !document.hidden) void ctx.resume()
}

// load (or reuse) a car's engine loop and switch the looping source to it
function startEngine(url: string) {
  if (!ctx) return
  const audio = ctx
  const begin = (buf: AudioBuffer) => {
    if (engineUrl !== url || !ctx) return // a newer swap superseded this load
    if (engineSrc) {
      try {
        engineSrc.stop()
      } catch {
        /* already stopped */
      }
      engineSrc.disconnect()
    }
    engineSrc = audio.createBufferSource()
    engineSrc.buffer = buf
    engineSrc.loop = true
    engineSrc.connect(sampleFilter)
    engineSrc.start()
  }
  const cached = engineBuffers.get(url)
  if (cached) {
    begin(cached)
    return
  }
  fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => audio.decodeAudioData(b))
    .then((buf) => {
      engineBuffers.set(url, buf)
      begin(buf)
    })
    .catch((e) => console.warn('engine loop load failed', url, e))
}

// pick the current car's engine recording; safe to call before audio starts
export function setEngineLoop(url: string) {
  engineUrl = url
  if (ctx) startEngine(url)
}

// the recorded loop is pitched by rpm; pitch = per-car base speed, growl = tone
export function updateEngine(
  speedRatio: number,
  rpm: number,
  shifting: boolean,
  throttle = 0,
  slideRatio = 0,
  pitch = 1,
  growl = 1,
) {
  if (!ctx) return
  const t = ctx.currentTime
  const load = 0.35 + throttle * 0.65
  const moving = Math.min(1, speedRatio * 5)

  // recorded engine loop: pitch tracks rpm, level tracks load, tone opens on the gas
  if (engineSrc) {
    const pitchMul = 0.78 + 0.18 * pitch // per-car base pitch, gently (raw pitch would chipmunk)
    engineSrc.playbackRate.setTargetAtTime(pitchMul * (0.82 + 0.85 * rpm + 0.1 * speedRatio), t, 0.05)
  }
  const sv = (0.06 + 0.24 * moving) * load // the only engine source now, so a touch louder
  sampleGain.gain.setTargetAtTime(shifting ? sv * 0.7 : sv, t, 0.05) // gentle dip on shift, not a cut-out
  sampleFilter.frequency.setTargetAtTime((450 + rpm * 2600 + throttle * 1500) * growl, t, 0.06)

  // tire squeal ramps harder with slip; wind rush at speed
  scrubGain.gain.setTargetAtTime(Math.min(0.065, slideRatio * slideRatio * 0.07), t, 0.05)
  if (windGain) windGain.gain.setTargetAtTime(Math.min(0.028, speedRatio * speedRatio * 0.032), t, 0.12)
}

// Mechanical gearbox clunk: a short filtered noise clack + a soft low thunk for
// weight. No tonal frequency ramp — that "bloop" was the bad part.
export function playShift(direction: -1 | 1) {
  if (!ctx) return
  const t = ctx.currentTime

  const clack = ctx.createBufferSource()
  clack.buffer = makeClickBuffer(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = direction > 0 ? 550 : 420 // low + dull — just a faint tick under the boom
  bp.Q.value = 0.6
  const clackGain = ctx.createGain()
  clackGain.gain.setValueAtTime(0.015, t) // barely there now
  clackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
  clack.connect(bp)
  bp.connect(clackGain)
  clackGain.connect(master)
  clack.start(t)

  // the boom: a deep low thump that carries the whole shift
  const thunk = ctx.createOscillator()
  thunk.type = 'sine'
  thunk.frequency.setValueAtTime(direction > 0 ? 95 : 78, t)
  thunk.frequency.exponentialRampToValueAtTime(38, t + 0.09)
  const thunkGain = ctx.createGain()
  thunkGain.gain.setValueAtTime(0.1, t)
  thunkGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
  thunk.connect(thunkGain)
  thunkGain.connect(master)
  thunk.start(t)
  thunk.stop(t + 0.15)
}

// pitch 1 = the player's horn; traffic honks lower and quieter
export function honk(pitch = 1) {
  if (!ctx) return
  const t = ctx.currentTime
  for (const f of [392, 494]) {
    const o = ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = f * pitch
    const g = ctx.createGain()
    g.gain.setValueAtTime(pitch === 1 ? 0.07 : 0.04, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    o.connect(g)
    g.connect(master)
    o.start(t)
    o.stop(t + 0.4)
  }
}

// thud + clatter for smacking props and taking hits, scaled by intensity 0..1
export function playImpact(intensity: number) {
  if (!ctx) return
  const t = ctx.currentTime
  const k = Math.min(1, Math.max(0.2, intensity))

  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(110, t)
  thump.frequency.exponentialRampToValueAtTime(38, t + 0.12)
  const tg = ctx.createGain()
  tg.gain.setValueAtTime(0.11 * k, t)
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
  thump.connect(tg)
  tg.connect(master)
  thump.start(t)
  thump.stop(t + 0.16)

  const clatter = ctx.createBufferSource()
  clatter.buffer = makeClickBuffer(ctx)
  const cf = ctx.createBiquadFilter()
  cf.type = 'bandpass'
  cf.frequency.value = 900 + 900 * k
  const cg = ctx.createGain()
  cg.gain.setValueAtTime(0.09 * k, t)
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
  clatter.connect(cf)
  cf.connect(cg)
  cg.connect(master)
  clatter.start(t)
}

export function setMuted(m: boolean) {
  muted = m
  if (ctx) master.gain.value = m ? 0 : 1
}

function makeNoiseBuffer(audio: AudioContext) {
  const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function makeClickBuffer(audio: AudioContext) {
  const length = Math.max(1, Math.floor(audio.sampleRate * 0.045))
  const buffer = audio.createBuffer(1, length, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    const fade = 1 - i / length
    data[i] = (Math.random() * 2 - 1) * fade * fade
  }
  return buffer
}
