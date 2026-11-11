import { toPlan } from '~/features/branches'
import type { SurroundingsPlan } from '~/features/branches'
import type { GatewaySide } from './network'
import type { RideCourse, VehicleRoute } from './ride'
import { vehicleRoute } from './ride'
import type { Vec2 } from './vec'

/** The lane's lines and turns, in the café's front frame (cm), as plan points in metres. */
function laneGeometry({ frame, lane }: SurroundingsPlan) {
  const point = (u: number, n: number): Vec2 => {
    const { x, y } = toPlan(frame, u, n)
    return { x: x / 100, z: y / 100 }
  }
  const far = lane.n1 - 90
  const near = lane.n0 + 90
  const middle = (far + near) / 2
  const radius = (far - near) / 2
  /** A U-turn from the far line (heading −u) onto the near line (heading +u) at `turn`. */
  const uTurn = (turn: number) => Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI
    return point(turn - Math.sin(angle) * radius, middle + Math.cos(angle) * radius)
  })
  return { point, far, near, turnAt: lane.u0 + 340, uTurn, pickup: point(430, far) }
}

/** The E2 demo route uses both sides of the existing lane and turns within its road surface. */
export function buildRideCourse(plan: SurroundingsPlan): RideCourse {
  const { lane } = plan
  const { point, far, near, turnAt, uTurn, pickup } = laneGeometry(plan)
  const approach = vehicleRoute(point(lane.u1 - 160, far), pickup, 3.5)
  const bend = uTurn(turnAt)

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

/**
 * The tuk-tuk's legs through the gateways (step E4): `out` from the pickup to under the arch at
 * that end, `in` from under the arch to the café's curb. Every arrival stops on the near line,
 * heading +u, so the passenger side faces the café as at the E2 drop-offs.
 */
export type RideLegs = Record<GatewaySide, { out: VehicleRoute, in: VehicleRoute }>

export function buildRideLegs(plan: SurroundingsPlan): RideLegs {
  const { lane } = plan
  const { point, far, near, turnAt, uTurn, pickup } = laneGeometry(plan)
  const dropoff = point(0, near)
  return {
    // The pickup faces −u: straight on to the lane's start, or round the turn to its end.
    start: {
      out: vehicleRoute(pickup, point(lane.u0 + 60, far), 4.2),
      in: vehicleRoute(point(lane.u0 + 60, near), dropoff, 4.2),
    },
    end: {
      out: vehicleRoute(pickup, point(lane.u1 - 60, near), 4.2, uTurn(turnAt)),
      in: vehicleRoute(point(lane.u1 - 60, far), dropoff, 4.2, uTurn(turnAt)),
    },
  }
}
