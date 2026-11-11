import type { CameraPose } from './camera'
import { cameraPose } from './camera'
import type { VehiclePose } from './ride'
import { vehiclePoint } from './ride'
import { add, facing } from './vec'
import type { WalkWorld } from './walk-world'

export interface PassengerView {
  outside: boolean
  yaw: number
  pitch: number
}

const YAW_LIMIT = 110 * Math.PI / 180
const PITCH_LIMIT = Math.PI / 6

export function lookFromSeat(view: PassengerView, dx: number, dy: number) {
  view.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, view.yaw - dx))
  view.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, view.pitch + dy))
}

export function passengerCamera(view: PassengerView, vehicle: VehiclePose, street: number, world: WalkWorld): CameraPose {
  if (view.outside) {
    return cameraPose({
      yaw: vehicle.heading + Math.PI,
      pitch: 0.28,
      distance: 5.1,
      sinceLook: 0,
      far: true,
    }, { world, feet: { ...vehicle.position, y: street + 0.12 }, ceiling: null, shoulder: 0 })
  }

  const eye = vehiclePoint(vehicle, -0.23, -0.65)
  const y = street + 1.42
  const ahead = add(eye, facing(vehicle.heading + view.yaw), Math.cos(view.pitch))
  return { position: { ...eye, y }, target: { ...ahead, y: y - Math.sin(view.pitch) }, pulledIn: false }
}
