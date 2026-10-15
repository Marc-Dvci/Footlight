// Done criterion 4: walking on through the lines dims each crossed line, then the lines fade and
// the beat stops.

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getController, head, report, waitUntil, walk} from "./FootlightTestKit"

@component
export class WalkThroughScenario extends Scenario {
  async run(): Promise<void> {
    const c = await getController()
    await walk(c, head(c, 0, -20), head(c, 0, -230))
    await waitUntil(() => c.lastFrame !== null && c.lastFrame.state === "cueing" && c.lastFrame.plan !== null, 3, "cue in the doorway")
    await sleep(1200) // frozen for a moment, lines fully rolled out
    const n = c.lastFrame.plan.lines.length
    const lastZ = c.lastFrame.plan.lines[n - 1].center.z

    // Per line: the lowest opacity seen while it was crossed and the cue was still showing.
    const dimmed: number[] = []
    for (let i = 0; i < n; i++) {
      dimmed.push(1)
    }
    let sawFading = false
    let beatsInFade = 0
    let lastBeats = c.beatCount
    const watch = () => {
      const f = c.lastFrame
      if (!f) {
        return
      }
      for (let i = 0; i < f.lines.length && i < n; i++) {
        if (f.lines[i].crossed && f.state === "cueing") {
          dimmed[i] = Math.min(dimmed[i], c.lineOpacity(i))
        }
      }
      if (f.state === "fading") {
        sawFading = true
        beatsInFade += c.beatCount - lastBeats
      }
      lastBeats = c.beatCount
    }

    // Walk on through all the lines and well past the last one.
    await walk(c, head(c, 0, -230), head(c, 0, lastZ - 120), 70, watch)
    await waitUntil(() => c.lastFrame.state === "hidden", 4, "lines faded out", watch)

    const crossed = c.lastFrame.lines.length === 0
    report("C4 lowest opacity of each crossed line while cueing: " + dimmed.map((d) => d.toFixed(2)).join(", "))
    report("C4 saw fading " + sawFading + ", beats during the fade " + beatsInFade)
    expect(crossed, "no lines left on the floor").toBe(true)
    expect(sawFading, "lines faded (fading state)").toBe(true)
    // Every line except the last dims while the cue is still up (the last crossing starts the fade).
    for (let i = 0; i < n - 1; i++) {
      expect(dimmed[i] < 0.6, "line " + i + " dimmed after it was crossed (" + dimmed[i].toFixed(2) + ")").toBe(true)
    }
    for (let i = 0; i < n; i++) {
      expect(c.lineOpacity(i)).toBe(0)
    }

    // The beat stops.
    expect(c.lastFrame.beatActive).toBe(false)
    const beatsAtEnd = c.beatCount
    await sleep(1500)
    report("C4 beats in the 1.5 s after the fade: " + (c.beatCount - beatsAtEnd))
    expect(c.beatCount).toBe(beatsAtEnd)
    c.clearPoseOverride()
  }
}
