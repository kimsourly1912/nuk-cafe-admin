/**
 * From the layout's units to three.js's (D273): centimetres become metres; the plan's x stays x,
 * its y (down the screen) becomes z, and up is y. A clockwise turn on the plan of `degrees` is a
 * three.js Y rotation of −degrees: clockwise maps (1, 0) to (cos θ, sin θ) on the plan, (cos θ, 0,
 * sin θ) in the world, and a Y rotation φ maps x to (cos φ, 0, −sin φ).
 */
export function cm(value: number): number {
  return value / 100
}

export function yRotation(degrees: number): number {
  return -(degrees * Math.PI) / 180
}

/** Fit a bounding sphere within the narrower field of view, with margin. */
export function fitDistance(radius: number, verticalFov: number, aspect: number): number {
  const vertical = (verticalFov * Math.PI) / 360
  const horizontal = Math.atan(Math.tan(vertical) * aspect)
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.05
}
