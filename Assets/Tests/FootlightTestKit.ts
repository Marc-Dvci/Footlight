// Shared helpers for the Footlight LEAF scenarios. Walks go through the controller's pose override,
// so the engine sees them exactly as it sees the camera (same detector path as WASD walking).

import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {findInteractablesByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {findSceneObjectByName, nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {FootlightController} from "../Scripts/FootlightController"
import {yawOf} from "../Scripts/Core/FootlightMath"

export const WALK_CM_S = 70
export const EYE_CM = 160
export const DOOR_Z = -300

export function report(msg: string): void {
  print("[FootlightTest] " + msg)
}

export async function getController(): Promise<FootlightController> {
  const obj = findSceneObjectByName("Footlight")
  if (!obj) {
    throw new Error('Scene object "Footlight" not found')
  }
  const c = obj.getComponent(FootlightController.getTypeName()) as FootlightController
  if (!c) {
    throw new Error("FootlightController not found on Footlight")
  }
  // Let the floor probe and the panels settle before driving the pose.
  const t0 = getTime()
  while (getTime() - t0 < 4 && (c.floorFoundBy === "none" || !c.ui.isReady)) {
    await nextFrame()
  }
  await sleep(300)
  return c
}

/** Head position at floor point (x, z), at eye height. */
export function head(c: FootlightController, x: number, z: number): vec3 {
  return new vec3(x, c.floorHeight + EYE_CM, z)
}

/** Walks the pose override from `from` to `to` at `speed` cm/s, one step per frame. */
export async function walk(c: FootlightController, from: vec3, to: vec3, speed: number = WALK_CM_S, onFrame?: () => void): Promise<void> {
  const yaw = yawOf({x: to.x - from.x, z: to.z - from.z})
  const dist = from.distance(to)
  const t0 = getTime()
  for (;;) {
    const s = Math.min(1, ((getTime() - t0) * speed) / Math.max(dist, 1e-3))
    c.setPoseOverride(vec3.lerp(from, to, s), yaw)
    if (onFrame) {
      onFrame()
    }
    if (s >= 1) {
      return
    }
    await nextFrame()
  }
}

/** Waits until `cond` holds, or throws after `timeoutS`. Returns the seconds waited. */
export async function waitUntil(cond: () => boolean, timeoutS: number, what: string, onFrame?: () => void): Promise<number> {
  const t0 = getTime()
  while (!cond()) {
    if (getTime() - t0 > timeoutS) {
      throw new Error("Timed out after " + timeoutS + " s waiting for: " + what)
    }
    if (onFrame) {
      onFrame()
    }
    await nextFrame()
  }
  return getTime() - t0
}

export function interactable(name: string): Interactable {
  const list = findInteractablesByName(name, undefined, true)
  if (!list.length) {
    throw new Error('Interactable "' + name + '" not found or not enabled')
  }
  return list[0]
}

export function textOf(objName: string): string {
  const obj = findSceneObjectByName(objName)
  if (!obj) {
    throw new Error('Scene object "' + objName + '" not found')
  }
  const t = obj.getComponent("Component.Text") as Text
  return t ? t.text : ""
}
