import { CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Material, Texture } from 'three'
import type { Finish } from '#shared/contracts/shop-layout'
import { FINISH_SWATCHES } from '../catalog'

/**
 * The 3D materials (D273): one per finish and per building surface, shared by every mesh that uses
 * it. Grain, weave, speckle, planks and tiles are drawn on a canvas once, so the warm, detailed look
 * of the owner's visual target costs no image downloads. Without a DOM (unit tests) the materials
 * are plain colors.
 */

export type SurfaceKey = 'plaster' | 'plaster-outside' | 'floor-wood' | 'floor-tiles' | 'slab' | 'roof' | 'glass' | 'frame' | 'leaf' | 'leaf-dark' | 'soil' | 'ground' | 'highlight' | 'lamp' | 'plinth' | 'ceramic' | 'contact-shadow' | 'pastry' | 'chalkboard'
  | FigureSurface | LaneSurface

/** People and pets (step 3g): skin tones, hair, fur and the red-check krama. */
export type FigureSurface = 'skin-light' | 'skin-medium' | 'skin-deep' | 'hair-black' | 'hair-grey' | 'fur-ginger' | 'fur-cream' | 'fur-tan' | 'fur-dark' | 'eye' | 'krama' | 'shirt-white' | 'shoe'

/** The Neighborhood lane (step 3h): pastel plaster, shutters, gates, awnings, roof tiles, paving. */
export type LaneSurface = 'paint-yellow' | 'paint-mint' | 'paint-peach' | 'paint-cream' | 'paint-blue'
  | 'shutter-green' | 'shutter-blue' | 'shutter-brown' | 'gate' | 'awning-red' | 'awning-green' | 'awning-blue'
  | 'roof-tile' | 'pavers' | 'yard' | 'lane' | 'curb' | 'drain' | 'base-edge' | 'window-lit' | 'trunk'
  | 'bougainvillea' | 'moto-red' | 'rubber' | 'chrome' | 'jar' | 'wire' | 'concrete'

export interface MaterialLibrary {
  finish: (finish: Finish) => Material
  surface: (key: SurfaceKey) => Material
  setTheme: (dark: boolean) => void
  dispose: () => void
}

type Pattern = 'grain' | 'weave' | 'speckle' | 'planks' | 'tiles' | 'plaster' | 'shadow' | 'check' | 'pavers' | 'stripes' | 'roof-tiles'

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
    // Step 3f: the pastry case's pastries and the menu board's slate.
    case 'pastry': return new MeshStandardMaterial({ color: '#c98a45', roughness: 0.75 })
    case 'chalkboard': return new MeshStandardMaterial({ color: '#2b2f2c', roughness: 0.95 })
    // A soft dark spot under a figure (step 3g): no light, no depth writes, drawn over the floor.
    case 'contact-shadow': return new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, alphaMap: pattern('shadow') })
    case 'skin-light': return new MeshStandardMaterial({ color: '#e0b48f', roughness: 0.7 })
    case 'skin-medium': return new MeshStandardMaterial({ color: '#c08a62', roughness: 0.7 })
    case 'skin-deep': return new MeshStandardMaterial({ color: '#8e5c3c', roughness: 0.7 })
    case 'hair-black': return new MeshStandardMaterial({ color: '#1d1714', roughness: 0.55 })
    case 'hair-grey': return new MeshStandardMaterial({ color: '#b9b3aa', roughness: 0.6 })
    case 'fur-ginger': return new MeshStandardMaterial({ color: '#c97a3a', roughness: 0.85 })
    case 'fur-cream': return new MeshStandardMaterial({ color: '#efe2c8', roughness: 0.85 })
    case 'fur-tan': return new MeshStandardMaterial({ color: '#a8743f', roughness: 0.85 })
    case 'fur-dark': return new MeshStandardMaterial({ color: '#2e2622', roughness: 0.85 })
    case 'eye': return new MeshStandardMaterial({ color: '#141110', roughness: 0.2 })
    // The krama's red and white check (the owner's visual target), drawn once on a canvas.
    // Both sides: a hammock's cloth and an open scarf are seen from inside too.
    case 'krama': return new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, map: pattern('check'), side: DoubleSide })
    case 'shirt-white': return new MeshStandardMaterial({ color: '#f1ece3', roughness: 0.9, map: pattern('weave') })
    case 'shoe': return new MeshStandardMaterial({ color: '#2a221d', roughness: 0.6 })
    // The lane (step 3h). Textured surfaces get their tiling from their geometry's UVs.
    case 'paint-yellow': return new MeshStandardMaterial({ color: '#e6cf8e', roughness: 0.92, map: pattern('plaster') })
    case 'paint-mint': return new MeshStandardMaterial({ color: '#aecdb6', roughness: 0.92, map: pattern('plaster') })
    case 'paint-peach': return new MeshStandardMaterial({ color: '#e4b596', roughness: 0.92, map: pattern('plaster') })
    case 'paint-cream': return new MeshStandardMaterial({ color: '#ede0c6', roughness: 0.92, map: pattern('plaster') })
    case 'paint-blue': return new MeshStandardMaterial({ color: '#adc5d4', roughness: 0.92, map: pattern('plaster') })
    case 'shutter-green': return new MeshStandardMaterial({ color: '#4f7a5a', roughness: 0.7, map: pattern('stripes') })
    case 'shutter-blue': return new MeshStandardMaterial({ color: '#4d6f8a', roughness: 0.7, map: pattern('stripes') })
    case 'shutter-brown': return new MeshStandardMaterial({ color: '#7a4a2f', roughness: 0.7, map: pattern('stripes') })
    case 'gate': return new MeshStandardMaterial({ color: '#8d8a84', roughness: 0.5, metalness: 0.5, map: pattern('stripes') })
    case 'awning-red': return new MeshStandardMaterial({ color: '#a8442f', roughness: 0.6, metalness: 0.2, map: pattern('stripes'), side: DoubleSide })
    case 'awning-green': return new MeshStandardMaterial({ color: '#4f7a5a', roughness: 0.6, metalness: 0.2, map: pattern('stripes'), side: DoubleSide })
    case 'awning-blue': return new MeshStandardMaterial({ color: '#3f6a8a', roughness: 0.6, metalness: 0.2, map: pattern('stripes'), side: DoubleSide })
    case 'roof-tile': return new MeshStandardMaterial({ color: '#a7563a', roughness: 0.85, map: pattern('roof-tiles'), side: DoubleSide })
    case 'pavers': return new MeshStandardMaterial({ color: '#bcae9c', roughness: 0.95, map: pattern('pavers') })
    case 'yard': return new MeshStandardMaterial({ color: '#a99c8c', roughness: 0.95, map: pattern('pavers') })
    case 'lane': return new MeshStandardMaterial({ color: '#7d766d', roughness: 0.95, map: pattern('speckle') })
    case 'curb': return new MeshStandardMaterial({ color: '#d2c8b8', roughness: 0.9 })
    case 'drain': return new MeshStandardMaterial({ color: '#3a3531', roughness: 0.7, map: pattern('stripes') })
    case 'base-edge': return new MeshStandardMaterial({ color: '#5a4b40', roughness: 0.85 })
    // A lit room behind a window: the evening of the owner's references.
    case 'window-lit': return new MeshStandardMaterial({ color: '#3b2f27', roughness: 0.4, emissive: new Color('#f2a756'), emissiveIntensity: 0.35 })
    case 'trunk': return new MeshStandardMaterial({ color: '#6a4a32', roughness: 0.9 })
    case 'bougainvillea': return new MeshStandardMaterial({ color: '#d4508c', roughness: 0.8, flatShading: true })
    case 'moto-red': return new MeshStandardMaterial({ color: '#a3252b', roughness: 0.35, metalness: 0.3 })
    case 'rubber': return new MeshStandardMaterial({ color: '#1c1a19', roughness: 0.8 })
    case 'chrome': return new MeshStandardMaterial({ color: '#c9c6c0', roughness: 0.2, metalness: 0.9 })
    case 'jar': return new MeshStandardMaterial({ color: '#7d4527', roughness: 0.35 })
    case 'wire': return new MeshStandardMaterial({ color: '#1e1b19', roughness: 0.6 })
    case 'concrete': return new MeshStandardMaterial({ color: '#b7b0a6', roughness: 0.95, map: pattern('speckle') })
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
    case 'pavers': {
      // Staggered rows of small pavers with mortar lines: 4 rows of 2 on a tile.
      const row = size / 4
      context.fillStyle = 'rgba(60, 50, 40, 0.35)'
      for (let line = 0; line < 4; line++) {
        context.fillRect(0, line * row, size, 3)
        const shift = line % 2 ? size / 4 : 0
        for (let column = 0; column < 3; column++) context.fillRect((shift + column * size / 2) % size, line * row, 3, row)
        context.fillStyle = `rgba(60, 50, 40, ${0.05 + random() * 0.08})`
        context.fillRect(shift + 4, line * row + 4, size / 2 - 8, row - 8)
        context.fillStyle = 'rgba(60, 50, 40, 0.35)'
      }
      break
    }
    case 'stripes': {
      // Corrugated sheet, louvres, a drain grille: soft bands, 16 to a tile.
      const band = size / 16
      for (let line = 0; line < 16; line++) {
        context.fillStyle = 'rgba(0, 0, 0, 0.22)'
        context.fillRect(line * band, 0, band * 0.4, size)
      }
      break
    }
    case 'roof-tiles': {
      // Rows of curved clay tiles, each row darker where the next overlaps it.
      const row = size / 6
      const tile = size / 8
      for (let line = 0; line < 6; line++) {
        const gradient = context.createLinearGradient(0, line * row, 0, (line + 1) * row)
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
        gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0)')
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.12)')
        context.fillStyle = gradient
        context.fillRect(0, line * row, size, row)
        context.fillStyle = 'rgba(0, 0, 0, 0.18)'
        for (let column = 0; column < 8; column++) context.fillRect(column * tile + (line % 2 ? tile / 2 : 0), line * row, 2, row)
      }
      break
    }
    case 'check': {
      const cell = size / 8
      context.fillStyle = '#b3262b'
      context.fillRect(0, 0, size, size)
      context.fillStyle = 'rgba(255, 255, 255, 0.55)'
      for (let line = 0; line < 8; line += 2) {
        context.fillRect(line * cell, 0, cell, size)
        context.fillRect(0, line * cell, size, cell)
      }
      break
    }
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
