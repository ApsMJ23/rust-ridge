import * as THREE from 'three'
import { TUNING as T } from './tuning.ts'

const BASE_FOV = 62

// Chase camera: sits behind the car along its heading, follows with
// frame-rate-independent damping, and widens FOV with speed for the rush.
// During a slide the anchor blends toward the velocity direction — the camera
// hangs behind where the car is GOING, so a drift shows the car at an angle.
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera
  private readonly desired = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private fovRatio = 0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 1200)
    this.camera.position.set(0, T.camHeight, T.camDist)
  }

  update(
    dt: number,
    target: THREE.Vector3,
    heading: number,
    speedRatio: number,
    velHeading = heading,
    driftBlend = 0,
  ) {
    let dh = velHeading - heading
    dh = ((dh + Math.PI) % (Math.PI * 2)) - Math.PI
    if (dh < -Math.PI) dh += Math.PI * 2
    const h = heading + dh * driftBlend
    this.desired.set(
      target.x + Math.sin(h) * T.camDist,
      T.camHeight,
      target.z + Math.cos(h) * T.camDist,
    )
    this.camera.position.lerp(this.desired, 1 - Math.exp(-T.camLag * dt))
    this.look.set(target.x, 1.2, target.z)
    this.camera.lookAt(this.look)

    this.fovRatio += (speedRatio - this.fovRatio) * (1 - Math.exp(-3 * dt))
    this.camera.fov = BASE_FOV + T.fovKick * this.fovRatio
    this.camera.updateProjectionMatrix()
  }
}
