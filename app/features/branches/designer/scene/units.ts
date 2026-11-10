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
