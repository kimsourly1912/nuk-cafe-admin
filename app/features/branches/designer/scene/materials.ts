import { CanvasTexture, Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Material, Texture } from 'three'
import type { Finish } from '#shared/contracts/shop-layout'
import { FINISH_SWATCHES } from '../catalog'

/**
 * The 3D materials (D273): one per finish and per building surface, shared by every mesh that uses
 * it. Grain, weave, speckle, planks and tiles are drawn on a canvas once, so the warm, detailed look
 * of the owner's visual target costs no image downloads. Without a DOM (unit tests) the materials
 * are plain colors.
 */

export type SurfaceKey = 'plaster' | 'plaster-outside' | 'floor-wood' | 'floor-tiles' | 'slab' | 'roof' | 'glass' | 'frame' | 'leaf' | 'leaf-dark' | 'soil' | 'ground' | 'highlight' | 'lamp' | 'plinth' | 'ceramic' | 'contact-shadow'

export interface MaterialLibrary {
  finish: (finish: Finish) => Material
  surface: (key: SurfaceKey) => Material
  setTheme: (dark: boolean) => void
  dispose: () => void
}

type Pattern = 'grain' | 'weave' | 'speckle' | 'planks' | 'tiles' | 'plaster' | 'shadow'

export function createMaterialLibrary(): MaterialLibrary {
  const textures = new Map<Pattern, Texture>()
  const finishes = new Map<Finish, Material>()
  const surfaces = new Map<SurfaceKey, Material>()

  function pattern(key: Pattern): Texture | null {
    if (typeof document === 'undefined') return null
    let texture = textures.get(key)
    if (!texture) {
      texture = new CanvasTexture(drawPattern(key))
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 4
      textures.set(key, texture)
    }
    return texture
  }

  function finish(key: Finish): Material {
    let material = finishes.get(key)
    if (material) return material
    const swatch = FINISH_SWATCHES[key]
    const color = new Color(swatch.color)
    switch (swatch.material) {
      case 'wood':
        material = new MeshStandardMaterial({ color, roughness: 0.52, metalness: 0, map: pattern('grain') })
        break
      case 'metal':
        material = new MeshStandardMaterial({ color, roughness: 0.36, metalness: 0.75 })
        break
      case 'fabric':
        material = new MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 0.7, sheenRoughness: 0.6, sheenColor: color.clone().offsetHSL(0, -0.1, 0.25), map: pattern('weave') })
        break
      case 'stone':
        material = new MeshStandardMaterial({ color, roughness: 0.42, metalness: 0, map: pattern('speckle') })
        break
    }
    finishes.set(key, material)
    return material
  }

  function surface(key: SurfaceKey): Material {
    let material = surfaces.get(key)
    if (material) return material
    material = makeSurface(key, pattern)
    surfaces.set(key, material)
    return material
  }

  function setTheme(dark: boolean) {
    const ground = surface('ground') as MeshStandardMaterial
    ground.color.set(dark ? '#2a221d' : '#e4ddd4')
  }

  function dispose() {
    for (const material of [...finishes.values(), ...surfaces.values()]) material.dispose()
    for (const texture of textures.values()) texture.dispose()
    finishes.clear()
    surfaces.clear()
    textures.clear()
  }

  return { finish, surface, setTheme, dispose }
}

function makeSurface(key: SurfaceKey, pattern: (key: Pattern) => Texture | null): Material {
  switch (key) {
    case 'plaster': return new MeshStandardMaterial({ color: '#efe4d6', roughness: 0.9, map: pattern('plaster') })
    case 'plaster-outside': return new MeshStandardMaterial({ color: '#e2d3c0', roughness: 0.92, map: pattern('plaster') })
    case 'floor-wood': return new MeshStandardMaterial({ color: '#c08a55', roughness: 0.5, map: pattern('planks') })
    case 'floor-tiles': return new MeshStandardMaterial({ color: '#a89a8c', roughness: 0.7, map: pattern('tiles') })
    case 'slab': return new MeshStandardMaterial({ color: '#d8c8b4', roughness: 0.85 })
    case 'roof': return new MeshStandardMaterial({ color: '#4a4542', roughness: 0.9 })
    case 'glass': return new MeshPhysicalMaterial({ color: '#cfe1e6', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false })
    case 'frame': return new MeshStandardMaterial({ color: '#2b2622', roughness: 0.5, metalness: 0.4 })
    case 'leaf': return new MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.75, flatShading: true })
    case 'leaf-dark': return new MeshStandardMaterial({ color: '#36592a', roughness: 0.8, flatShading: true })
    case 'soil': return new MeshStandardMaterial({ color: '#3b2a1e', roughness: 1 })
    case 'ground': return new MeshStandardMaterial({ color: '#e4ddd4', roughness: 1 })
    case 'highlight': return new MeshStandardMaterial({ color: '#f5b544', roughness: 0.4, emissive: new Color('#f59e0b'), emissiveIntensity: 0.55 })
    case 'lamp': return new MeshStandardMaterial({ color: '#fff3d6', emissive: new Color('#ffcf85'), emissiveIntensity: 1.6 })
    case 'plinth': return new MeshStandardMaterial({ color: '#1f1b18', roughness: 0.7 })
    case 'ceramic': return new MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.3 })
    // A soft dark spot under a figure (step 3g): no light, no depth writes, drawn over the floor.
    case 'contact-shadow': return new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, alphaMap: pattern('shadow') })
  }
}

/** A tileable grayscale-ish pattern, multiplied by the material's color. */
function drawPattern(key: Pattern): HTMLCanvasElement {
  const size = key === 'planks' || key === 'tiles' ? 512 : 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const random = seeded(key.length * 97)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  switch (key) {
    // An alpha map: opaque (white) in the middle, fading to nothing (black) at the edge.
    case 'shadow': {
      const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(0.45, '#9a9a9a')
      gradient.addColorStop(1, '#000000')
      context.fillStyle = gradient
      context.fillRect(0, 0, size, size)
      break
    }
    case 'grain':
      for (let line = 0; line < 90; line++) {
        const y = random() * size
        context.strokeStyle = `rgba(80, 45, 15, ${0.04 + random() * 0.1})`
        context.lineWidth = 0.6 + random() * 2.2
        context.beginPath()
        context.moveTo(0, y)
        for (let x = 0; x <= size; x += 16) context.lineTo(x, y + Math.sin((x + y) / 37) * 3 + (random() - 0.5) * 1.5)
        context.stroke()
      }
      break
    case 'weave':
      for (let y = 0; y < size; y += 2) {
        for (let x = 0; x < size; x += 2) {
          const shade = 225 + Math.floor(random() * 30) - ((x + y) % 4 === 0 ? 10 : 0)
          context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`
          context.fillRect(x, y, 2, 2)
        }
      }
      break
    case 'speckle':
      for (let dot = 0; dot < 2600; dot++) {
        const shade = random() < 0.5 ? 0 : 255
        context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.05 + random() * 0.12})`
        context.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
      }
      break
    case 'plaster':
      // A whole wall stretches this one tile, so it stays faint: a texture, not blotches.
      for (let dot = 0; dot < 2400; dot++) {
        context.fillStyle = `rgba(120, 100, 80, ${random() * 0.018})`
        context.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 1.5)
      }
      break
    case 'planks': {
      // One tile is 1.2 m: six planks of 20 cm, each with grain and staggered joints.
      const plank = size / 6
      for (let row = 0; row < 6; row++) {
        const tone = 225 + Math.floor(random() * 30)
        context.fillStyle = `rgb(${tone}, ${tone - 6}, ${tone - 14})`
        context.fillRect(0, row * plank, size, plank)
        for (let line = 0; line < 14; line++) {
          const y = row * plank + random() * plank
          context.strokeStyle = `rgba(90, 50, 20, ${0.05 + random() * 0.08})`
          context.lineWidth = 0.6 + random() * 1.4
          context.beginPath()
          context.moveTo(0, y)
          context.lineTo(size, y + (random() - 0.5) * 4)
          context.stroke()
        }
        context.fillStyle = 'rgba(60, 35, 15, 0.35)'
        context.fillRect(0, row * plank, size, 1.5)
        const joint = ((row * 0.37) % 1) * size
        context.fillRect(joint, row * plank, 1.5, plank)
      }
      break
    }
    case 'tiles': {
      const tile = size / 4
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
          const tone = 220 + Math.floor(random() * 30)
          context.fillStyle = `rgb(${tone}, ${tone - 4}, ${tone - 10})`
          context.fillRect(column * tile, row * tile, tile, tile)
        }
      }
      context.strokeStyle = 'rgba(70, 60, 50, 0.45)'
      context.lineWidth = 3
      for (let line = 0; line <= 4; line++) {
        context.beginPath()
        context.moveTo(line * tile, 0)
        context.lineTo(line * tile, size)
        context.moveTo(0, line * tile)
        context.lineTo(size, line * tile)
        context.stroke()
      }
      break
    }
  }
  return canvas
}

/** A small deterministic random source, so the patterns look the same on every load. */
function seeded(seed: number): () => number {
  let state = seed || 1
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}
