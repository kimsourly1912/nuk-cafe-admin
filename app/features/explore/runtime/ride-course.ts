import { toPlan } from '~/features/branches'
import type { SurroundingsPlan } from '~/features/branches'
import type { RideCourse } from './ride'
import { vehicleRoute } from './ride'
import type { Vec2 } from './vec'

/** The E2 demo route uses both sides of the existing lane and turns within its road surface. */
export function buildRideCourse({ frame, lane }: SurroundingsPlan): RideCourse {
  const point = (u: number, n: number): Vec2 => {
    const { x, y } = toPlan(frame, u, n)
    return { x: x / 100, z: y / 100 }
  }
  const far = lane.n1 - 90
  const near = lane.n0 + 90
  const middle = (far + near) / 2
  const radius = (far - near) / 2
  const turn = lane.u0 + 340
  const pickup = point(430, far)
  const approach = vehicleRoute(point(lane.u1 - 160, far), pickup, 3.5)
  const bend = Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI
    return point(turn - Math.sin(angle) * radius, middle + Math.cos(angle) * radius)
  })

  return {
    approach,
    stops: [
      { id: 'front', label: 'Café entrance', route: vehicleRoute(pickup, point(0, near), 4.2, bend) },
      { id: 'shophouses', label: 'Shophouse row', route: vehicleRoute(pickup, point(-360, near), 4.2, bend) },
    ],
    leavePickup: point(lane.u0 - 25, far),
    leaveDropoff: point(lane.u1 + 25, near),
  }
}
