import * as THREE from 'three'
import { toonMat } from './look.ts'

// Mabel, the mission-giver: a parked van with headlight-eyes and a bumper
// smile — deliberately NOT windshield-eyes, which is Pixar's trade dress.
export class Npc {
  readonly mesh = new THREE.Group()
  readonly bubbleAnchor = new THREE.Object3D()

  constructor(x: number, z: number, faceYaw: number) {
    this.mesh.position.set(x, 0, z)
    this.mesh.rotation.y = faceYaw
    this.bubbleAnchor.position.set(0, 3.4, 0)
    this.mesh.add(this.bubbleAnchor)
  }

  // browser-only, like Car.loadModel
  async load(url: string) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const gltf = await new GLTFLoader().loadAsync(url)
    const model = gltf.scene
    model.rotation.y = Math.PI // kenney vehicles face +z

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(4.6 / Math.max(size.x, size.z))
    box.setFromObject(model)
    model.position.y = -box.min.y

    // realistic pass: keep the glTF's PBR materials, cast real shadows
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
    })
    this.mesh.add(model)

    // face: eyes on the headlights, smile on the bumper
    const w = box.max.x - box.min.x
    const h = box.max.y - box.min.y
    const frontZ = box.min.z - 0.03
    const white = toonMat('#ffffff')
    const dark = toonMat('#20242c')
    const eyeGeo = new THREE.SphereGeometry(0.21, 12, 10)
    const pupilGeo = new THREE.SphereGeometry(0.095, 10, 8)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, white)
      eye.position.set(sx * w * 0.28, h * 0.42, frontZ)
      const pupil = new THREE.Mesh(pupilGeo, dark)
      pupil.position.set(0, 0.02, -0.15)
      eye.add(pupil)
      this.mesh.add(eye)
    }
    const smile = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.08, 0.06), dark)
    smile.position.set(0, h * 0.22, frontZ)
    this.mesh.add(smile)

    this.bubbleAnchor.position.y = h + 1.0
  }
}
