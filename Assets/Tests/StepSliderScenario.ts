// Done criterion 2: the spacing between lines equals the Step target slider value (moving the slider
// from 45 to 60 cm changes the spacing to 60 cm). Drives the real UI: pill -> Set up home -> slider.

import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getController, head, interactable, report, waitUntil, walk} from "./FootlightTestKit"

@component
export class StepSliderScenario extends Scenario {
  async run(): Promise<void> {
    const c = await getController()
    const ix = new DefaultLeafInteractor()

    // Baseline: 45 cm, measured on a real freeze.
    expect(c.engine.getCueConfig().stepCm).toBe(45)

    await waitUntil(() => c.ui.isPillShown, 4, "the pill (standing still, no cue)")
    await ix.trigger(interactable("PillButton"))
    await waitUntil(() => c.ui.currentCard === "main", 2, "main card")
    await ix.trigger(interactable("SetuphomeButton"))
    await waitUntil(() => c.ui.currentCard === "setup" && c.isSetupMode, 2, "setup card")
    await sleep(300)

    // Drag the Step target knob to the right in small steps until it reads 60 cm.
    const slider = interactable("StepSlider")
    const right = findSceneObjectByName("StepSlider").getTransform().right
    // The slider snaps to 5 cm segments (about 3 cm of track each), so each drag is about one segment.
    // LEAF adds the drag vector every frame, so the step shrinks whenever a drag overshoots.
    let guard = 0
    let step = 0.5
    let lastDir = 0
    while (c.engine.getCueConfig().stepCm !== 60 && guard++ < 20) {
      const dir = c.engine.getCueConfig().stepCm < 60 ? 1 : -1
      if (lastDir !== 0 && dir !== lastDir) {
        step *= 0.6
      }
      lastDir = dir
      await ix.drag(slider, right.uniformScale(step * dir), 250)
      await sleep(150)
      report("C2 drag " + guard + ": " + c.ui.stepLabel)
    }
    report("C2 slider label: " + c.ui.stepLabel + " after " + guard + " drags")
    expect(c.engine.getCueConfig().stepCm).toBe(60)
    expect(c.ui.stepLabel.indexOf("60 cm") >= 0, "slider label shows 60 cm").toBe(true)

    await ix.trigger(interactable("DoneButton"))
    await waitUntil(() => c.ui.currentCard === "main" && !c.isSetupMode, 2, "back to main card")
    await ix.trigger(interactable("WalkButton"))
    await waitUntil(() => c.ui.currentCard === "none", 2, "cards closed (Walk)")

    // Walk into the doorway and stop: the spacing must now be 60 cm.
    await walk(c, head(c, 0, -20), head(c, 0, -200))
    await waitUntil(() => c.lastFrame !== null && c.lastFrame.state === "cueing" && c.lastFrame.plan !== null, 3, "cue after stopping")
    const lines = c.lastFrame.plan.lines
    expect(lines.length >= 2, "at least two lines").toBe(true)
    const gaps: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const dx = lines[i].center.x - lines[i - 1].center.x
      const dz = lines[i].center.z - lines[i - 1].center.z
      const gap = Math.sqrt(dx * dx + dz * dz)
      gaps.push(gap.toFixed(1))
      expect(gap).toBeCloseTo(60, 1)
    }
    report("C2 spacing after slider: " + gaps.join(", ") + " cm (" + lines.length + " lines)")
    c.clearPoseOverride()
  }
}
