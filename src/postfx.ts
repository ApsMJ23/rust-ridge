import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import type { QualitySettings } from './materials.ts'

// Cinematic post stack: render → optional AO → bloom → SMAA → output.
// Hardware MSAA is disabled once the composer is active; SMAA replaces it.

export class PostFX {
  readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly smaa: SMAAPass
  private gtao: GTAOPass | null = null
  private readonly renderPass: RenderPass
  private readonly size = new THREE.Vector2()

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    quality: QualitySettings,
  ) {
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    if (quality.ao) {
      this.gtao = new GTAOPass(scene, camera, innerWidth, innerHeight)
      this.gtao.output = GTAOPass.OUTPUT.Default
      this.composer.addPass(this.gtao)
    }

    // low strength + high threshold: bloom the sun/sky only, never lane paint
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.14, 0.5, 0.95)
    this.bloom.enabled = quality.bloom
    this.composer.addPass(this.bloom)

    this.smaa = new SMAAPass()
    this.composer.addPass(this.smaa)
    this.composer.addPass(new OutputPass())

    this.setSize(innerWidth, innerHeight)
  }

  setCamera(camera: THREE.Camera) {
    this.renderPass.camera = camera
    if (this.gtao) this.gtao.camera = camera
  }

  setSize(w: number, h: number) {
    this.size.set(w, h)
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    this.smaa.setSize(w, h)
    if (this.gtao) this.gtao.setSize(w, h)
  }

  setPixelRatio(r: number) {
    this.composer.setPixelRatio(r)
  }

  applyQuality(q: QualitySettings) {
    this.bloom.enabled = q.bloom
    if (this.gtao) this.gtao.enabled = q.ao
  }

  render() {
    this.composer.render()
  }
}
