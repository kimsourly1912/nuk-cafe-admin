import { AnimationMixer, Box3, Group, Mesh, Vector3 } from 'three'
import type { AnimationClip, Material, Object3D, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { FigureKind } from '#shared/contracts/shop-layout'
import { ITEM_SPECS } from '../catalog'
import type { ModelAsset } from '../models'
import { FIGURE_MODELS, modelUrl } from '../models'
import { cm } from './units'

/**
 * The figures' model files (step 3g, D274), loaded once per viewer and shared by every copy. A copy
 * of a rigged model is cloned with its skeleton (`SkeletonUtils.clone`), so each one can play its
 * own idle loop; geometry, materials and textures stay the file's, and are freed only when the
 * viewer goes (`dispose`), never with a scene rebuild.
 */

export interface FigureInstance {
  object: Object3D
  /** Plays the model's idle loop; null for a still model. */
  mixer: AnimationMixer | null
}

export interface ModelLibrary {
  /** A new copy of the kind's model, scaled to its height, standing on y = 0 and facing +z. */
  figure: (kind: FigureKind) => Promise<FigureInstance | null>
  dispose: () => void
}

interface Template {
  root: Object3D
  clips: AnimationClip[]
  asset: ModelAsset
}

export function createModelLibrary(): ModelLibrary {
  const loader = new GLTFLoader()
  const templates = new Map<FigureKind, Promise<Template>>()
  const loaded: Template[] = []
  let disposed = false

  function template(kind: FigureKind, asset: ModelAsset): Promise<Template> {
    let pending = templates.get(kind)
    if (!pending) {
      pending = loader.loadAsync(modelUrl(asset)).then((gltf) => {
        const loadedTemplate = { root: normalized(gltf.scene, kind, asset), clips: gltf.animations, asset }
        if (disposed) disposeObject(loadedTemplate.root)
        else loaded.push(loadedTemplate)
        return loadedTemplate
      })
      // A failed load (offline, a blocked request) is tried again by the next scene.
      pending.catch(() => templates.delete(kind))
      templates.set(kind, pending)
    }
    return pending
  }

  async function figure(kind: FigureKind): Promise<FigureInstance | null> {
    const asset = FIGURE_MODELS[kind]
    if (!asset || disposed) return null
    const source = await template(kind, asset)
    if (disposed) return null
    const object = clone(source.root)
    const clip = source.asset.idle ? source.clips.find(candidate => candidate.name === source.asset.idle) : undefined
    if (!clip) return { object, mixer: null }
    const mixer = new AnimationMixer(object)
    mixer.clipAction(clip).play()
    // Copies don't move in step; and the pose applies at once, so a still frame isn't a T-pose.
    mixer.setTime(Math.random() * clip.duration)
    return { object, mixer }
  }

  function dispose() {
    disposed = true
    for (const { root } of loaded) disposeObject(root)
    loaded.length = 0
    templates.clear()
  }

  return { figure, dispose }
}

/** The file's scene, turned to face +z, scaled to the kind's height, centred on its footprint. */
function normalized(scene: Object3D, kind: FigureKind, asset: ModelAsset): Object3D {
  const turned = new Group()
  scene.rotation.y = ((asset.turn ?? 0) * Math.PI) / 180
  turned.add(scene)
  turned.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(turned)
  const size = bounds.getSize(new Vector3())
  const scale = size.y > 0 ? cm(ITEM_SPECS[kind].height) / size.y : 1
  const root = new Group()
  turned.scale.setScalar(scale)
  const center = bounds.getCenter(new Vector3())
  turned.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
  root.add(turned)
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = false
    object.receiveShadow = true
  })
  return root
}

function disposeObject(root: Object3D) {
  const materials = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose()
    }
    material.dispose()
  }
}
