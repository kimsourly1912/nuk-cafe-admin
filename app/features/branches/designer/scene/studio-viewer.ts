import { Box3, CircleGeometry, Mesh, MeshStandardMaterial, RingGeometry, Sphere, Vector3 } from 'three'
import type { Group } from 'three'
import type { BuildContext } from './furniture'
import type { StageOptions } from './stage'
import { createStage, tween } from './stage'

/**
 * The furniture studio's preview (the owner's references, 2026-11-10): one piece on a turntable,
 * in 3D or seen from above as the plan draws it.
 */

export interface StudioViewer {
  /** Replaces the piece; `build` runs with the stage's materials and geometry cache. */
  show: (build: (context: BuildContext) => Group) => void
  setView: (view: '3d' | 'top') => Promise<void>
  reset: () => Promise<void>
  setTheme: (dark: boolean) => void
  dispose: () => void
}

export function createStudioViewer(options: StageOptions): StudioViewer {
  const stage = createStage(options)
  const { camera, controls } = stage
  let view: '3d' | 'top' = '3d'
  let radius = 1
  let first = true

  controls.enablePan = false
  controls.minPolarAngle = 0
  controls.maxPolarAngle = 0.47 * Math.PI

  const turntableMaterial = new MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.08, roughness: 1 })
  const ringMaterial = new MeshStandardMaterial({ color: '#c8a27a', transparent: true, opacity: 0.25, roughness: 1 })

  function show(build: (context: BuildContext) => Group) {
    stage.clearContent()
    const piece = build(stage.context)
    piece.updateMatrixWorld(true)
    const sphere = new Box3().setFromObject(piece).getBoundingSphere(new Sphere())
    radius = Math.max(0.4, sphere.radius)
    const floorRadius = radius * 1.35
    const disc = new Mesh(new CircleGeometry(floorRadius, 72), turntableMaterial)
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.001
    disc.receiveShadow = true
    const ring = new Mesh(new RingGeometry(floorRadius * 0.995, floorRadius, 96), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.002
    stage.context.geometries.set('turntable', disc.geometry)
    stage.context.geometries.set('turntable-ring', ring.geometry)
    stage.scene.add(piece, disc, ring)
    stage.fitShadows(new Box3().setFromCenterAndSize(new Vector3(0, sphere.center.y, 0), new Vector3(radius * 3, radius * 2.5, radius * 3)))
    if (first) {
      first = false
      placeCamera(view)
      stage.measure()
    }
    else {
      controls.target.set(0, view === 'top' ? 0 : sphere.center.y * 0.8, 0)
    }
    stage.shadowsChanged()
  }

  function cameraFor(next: '3d' | 'top'): { position: Vector3, target: Vector3 } {
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15
    if (next === 'top') return { position: new Vector3(0, distance, 0.0001), target: new Vector3(0, 0, 0) }
    const target = new Vector3(0, radius * 0.75, 0)
    return { position: target.clone().add(new Vector3(0.75, 0.42, 1).normalize().multiplyScalar(distance)), target }
  }

  function placeCamera(next: '3d' | 'top') {
    const { position, target } = cameraFor(next)
    camera.position.copy(position)
    controls.target.copy(target)
    controls.minDistance = radius * 1.2
    controls.maxDistance = radius * 8
    controls.update()
    stage.invalidate()
  }

  async function setView(next: '3d' | 'top') {
    view = next
    controls.enableRotate = next === '3d'
    const { position, target } = cameraFor(next)
    const fromPosition = camera.position.clone()
    const fromTarget = controls.target.clone()
    await tween(stage, 450, (progress) => {
      camera.position.lerpVectors(fromPosition, position, progress)
      controls.target.lerpVectors(fromTarget, target, progress)
    })
    controls.update()
  }

  function dispose() {
    turntableMaterial.dispose()
    ringMaterial.dispose()
    stage.dispose()
  }

  return {
    show,
    setView,
    reset: () => setView(view),
    setTheme: stage.setTheme,
    dispose,
  }
}
