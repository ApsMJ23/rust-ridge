// All audio is synthesized with WebAudio: engine, tire scrub, shifts, and horn.
// initAudio must run from user gestures; call it from every gesture until the
// context actually resumes.
let ctx: AudioContext | null = null
let master: GainNode
let engOsc: OscillatorNode
let engSub: OscillatorNode
let engGain: GainNode
let engFilter: BiquadFilterNode
let scrubGain: GainNode
let muted = false

export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(ctx.destination)

    engGain = ctx.createGain()
    engGain.gain.value = 0
    engFilter = ctx.createBiquadFilter()
    engFilter.type = 'lowpass'
    engFilter.frequency.value = 320
    engFilter.Q.value = 0.5

    engOsc = ctx.createOscillator()
    engOsc.type = 'sawtooth'
    engSub = ctx.createOscillator()
    engSub.type = 'square'
    engSub.detune.value = -9 // slight beat against the main osc — thickens the drone
    const subGain = ctx.createGain()
    subGain.gain.value = 0.32
    engOsc.connect(engFilter)
    engSub.connect(subGain)
    subGain.connect(engFilter)
    engFilter.connect(engGain)
    engGain.connect(master)
    engOsc.start()
    engSub.start()

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

    // rAF stops in hidden tabs but WebAudio does not, so silence the drone.
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return
      if (document.hidden) void ctx.suspend()
      else void ctx.resume()
    })
  }
  if (ctx.state === 'suspended' && !document.hidden) void ctx.resume()
}

// pitch/growl give every car its own voice: pitch scales the oscillators
// (formula screams, firetruck rumbles), growl opens the filter for grit
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
  const f = (48 + 150 * rpm + 28 * speedRatio) * pitch
  engOsc.frequency.setTargetAtTime(f, t, 0.05)
  engSub.frequency.setTargetAtTime(f / 2, t, 0.06)
  engFilter.frequency.setTargetAtTime((260 + rpm * 480 + throttle * 260) * growl, t, 0.07)

  const moving = Math.min(1, speedRatio * 5)
  const vol = (0.018 + 0.075 * moving) * load * (0.5 + 0.5 * rpm)
  engGain.gain.setTargetAtTime(shifting ? vol * 0.3 : vol, t, 0.04)
  scrubGain.gain.setTargetAtTime(Math.min(0.045, slideRatio * 0.04), t, 0.06)
}

export function playShift(direction: -1 | 1) {
  if (!ctx) return
  const t = ctx.currentTime
  const chirp = ctx.createOscillator()
  chirp.type = direction > 0 ? 'triangle' : 'sawtooth'
  chirp.frequency.setValueAtTime(direction > 0 ? 220 : 165, t)
  chirp.frequency.exponentialRampToValueAtTime(direction > 0 ? 92 : 260, t + 0.11)

  const chirpGain = ctx.createGain()
  chirpGain.gain.setValueAtTime(0.055, t)
  chirpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13)
  chirp.connect(chirpGain)
  chirpGain.connect(master)
  chirp.start(t)
  chirp.stop(t + 0.14)

  const clack = ctx.createBufferSource()
  clack.buffer = makeClickBuffer(ctx)
  const clackGain = ctx.createGain()
  clackGain.gain.setValueAtTime(0.035, t)
  clackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  clack.connect(clackGain)
  clackGain.connect(master)
  clack.start(t + 0.015)
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
