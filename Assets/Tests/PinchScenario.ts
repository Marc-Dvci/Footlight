// Done criterion 3: a pinch anywhere brings up lines at once, with the beat.
// Uses a simulated SIK hand pinching in empty space (not on a button).

import {LeafHandInteractor} from "Leaf.lspkg/Interactors/interactor/LeafTwoHandInteractor"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getController, head, report, waitUntil} from "./FootlightTestKit"

@component
export class PinchScenario extends Scenario {
  async run(): Promise<void> {
    const c = await getController()
    // Stand still in the hallway, on open floor, facing the bathroom.
    c.setPoseOverride(head(c, 0, -60), 0)
    await sleep(600)
    expect(c.lastFrame === null || c.lastFrame.state === "hidden", "no cue before the pinch").toBe(true)

    const pinches0 = c.pinchCount
    const beats0 = c.beatCount
    const right = LeafHandInteractor.get("right")
    // The hand has to be tracked in an open pose before the pinch, as a real hand would be.
    await right.hand.makeGesture("relaxed")
    await right.hand.setScreenPosition(new vec2(0.5, 0.4), 60)
    await sleep(400)
    const t0 = getTime()
    await right.hand.makeGesture("pinch")
    await waitUntil(() => c.pinchCount > pinches0, 3, "the SIK pinch to reach Footlight")
    const sincePinch = getTime() - t0
    report("C3 pinch seen " + sincePinch.toFixed(2) + " s after the gesture started")

    const f = c.lastFrame
    expect(f !== null && f.plan !== null && f.state === "cueing", "lines are up on the pinch frame").toBe(true)
    expect(c.beatCount > beats0, "a beat sounded with the lines").toBe(true)
    expect(f.plan.mode).toBe("straight")
    const l0 = f.plan.lines[0]
    expect(Math.abs(l0.center.z - -60 + 22) < 0.5, "first line 22 cm ahead of where he stands").toBe(true)
    // Lines roll out from the toes: the first is visible within a few frames.
    const rollOut = await waitUntil(() => c.lineOpacity(0) > 0.5, 0.5, "first line visible")
    report("C3 first line visible " + rollOut.toFixed(2) + " s after the pinch registered; beats " + (c.beatCount - beats0))

    // The beat keeps going while he stays put.
    await sleep(1300)
    expect(c.beatCount - beats0 >= 2, "beat continues at the set tempo").toBe(true)
    report("C3 beats after 1.3 s: " + (c.beatCount - beats0))
    await right.hand.makeGesture("neutral")
    await right.hand.hide()
    c.clearPoseOverride()
  }
}
