import * as THREE from 'three'
import { TUNING as T } from './tuning.ts'

const BASE_FOV = 58

// Mounted chase rig: sits at a fixed offset behind the car in world space and
// eases to track its lateral position. Deliberately NO bank / shake / FOV kick /
// velocity sway — the view should feel bolted to a boom, not handheld. Forward
// is world -z, so the rig never yaws with the car; the road stays level.
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera
  private followX = 0
  private readonly look = new THREE.Vector3()

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.15, 1400)
    this.camera.position.set(0, T.camHeight, T.camDist)
  }

  // snap straight behind the car — spawn and restart, so it doesn't glide in
  reset(x: number, z: number) {
    this.followX = x
    this.camera.position.set(x, T.camHeight, z + T.camDist)
  }

  update(dt: number, target: THREE.Vector3) {
    // ease laterally so lane changes settle smoothly instead of the car sliding
    this.followX += (target.x - this.followX) * (1 - Math.exp(-7 * dt))
    this.camera.position.set(this.followX, T.camHeight, target.z + T.camDist)
    this.camera.up.set(0, 1, 0)
    this.look.set(this.followX, 1.2, target.z - T.camLookAhead)
    this.camera.lookAt(this.look)
  }
}
