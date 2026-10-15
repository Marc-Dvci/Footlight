// Done criterion 1: walking into the doorway spot and stopping brings up lines within 1 s; the first
// line is 22 cm ahead of the head's floor point and the lines run square through the doorway.

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {DOOR_Z, getController, head, report, waitUntil, walk} from "./FootlightTestKit"

@component
export class DoorwayFreezeScenario extends Scenario {
  async run(): Promise<void> {
    const c = await getController()
    const stopZ = -230
    await walk(c, head(c, 0, -20), head(c, 0, stopZ))
    const waited = await waitUntil(() => {
      const f = c.lastFrame
      return f !== null && f.state === "cueing" && f.plan !== null && c.lineOpacity(0) > 0
    }, 3, "cue lines after stopping in the doorway")
    report("C1 lines up " + waited.toFixed(2) + " s after stopping")
    expect(waited < 1.0, "lines must appear within 1 s of stopping (took " + waited.toFixed(2) + " s)").toBe(true)

    const f = c.lastFrame
    const plan = f.plan
    expect(f.spot !== null && f.spot.label === "Bathroom door", "stop is inside the Bathroom door spot").toBe(true)
    expect(plan.mode).toBe("doorway")

    // First line: 22 cm ahead of the head's floor point (12 cm toes + 10 cm gap).
    const l0 = plan.lines[0]
    const dFirst = Math.sqrt(l0.center.x * l0.center.x + (l0.center.z - stopZ) * (l0.center.z - stopZ))
    report("C1 first line " + dFirst.toFixed(2) + " cm ahead, " + plan.lines.length + " lines")
    expect(dFirst).toBeCloseTo(22, 1)
    expect(l0.center.z < stopZ, "first line is ahead (toward the door)").toBe(true)

    // The drawn strip sits where the plan says, 0.5 cm above the floor.
    await waitUntil(() => c.lineObjects[0].enabled, 1, "first line visual enabled")
    const p0 = c.lineObjects[0].getTransform().getWorldPosition()
    expect(p0.x).toBeCloseTo(l0.center.x, 1)
    expect(p0.z).toBeCloseTo(l0.center.z, 1)
    expect(p0.y - c.floorHeight).toBeCloseTo(0.5, 2)

    // Square through the doorway: every line lies parallel to the door wall (across the -z axis),
    // centred on the door axis, from before the door plane to no more than 60 cm past it.
    let before = 0
    let after = 0
    for (let i = 0; i < plan.lines.length; i++) {
      const l = plan.lines[i]
      expect(Math.abs(Math.sin(l.yaw)) < 1e-3, "line " + i + " square to the door (yaw " + l.yaw.toFixed(4) + ")").toBe(true)
      expect(l.center.x).toBeCloseTo(0, 2)
      const right = c.lineObjects[i].getTransform().right
      expect(Math.abs(right.z) < 1e-3, "line " + i + " visual runs along the door").toBe(true)
      if (l.center.z > DOOR_Z) {
        before++
      } else {
        after++
      }
      expect(l.center.z >= DOOR_Z - 60 - 0.01, "line " + i + " at most 60 cm past the door").toBe(true)
      if (i > 0) {
        expect(plan.lines[i - 1].center.z - l.center.z).toBeCloseTo(45, 1)
      }
    }
    report("C1 lines before door " + before + ", through/after door " + after)
    expect(before > 0 && after > 0, "lines run through the opening").toBe(true)
    c.clearPoseOverride()
  }
}
