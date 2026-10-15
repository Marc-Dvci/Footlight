// Done criterion 5: after a freeze and a restart, the Today card lists the freeze at "Bathroom door"
// with its duration. Opens the card through the real UI: pill -> Today.

import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getController, head, interactable, report, waitUntil, walk} from "./FootlightTestKit"

@component
export class TodayLogScenario extends Scenario {
  async run(): Promise<void> {
    const c = await getController()
    const before = c.engine.log.all().length

    // Freeze in the doorway for a few seconds, then walk on through the lines.
    await walk(c, head(c, 0, -20), head(c, 0, -230))
    await waitUntil(() => c.lastFrame !== null && c.lastFrame.gait === "frozen", 3, "freeze in the doorway")
    await sleep(2500)
    await walk(c, head(c, 0, -230), head(c, 0, -400))
    await waitUntil(() => c.lastFrame.state === "hidden", 4, "cue faded after walking on")
    // Turn round and walk back into the hallway (open floor), then stand still.
    await walk(c, head(c, 0, -400), head(c, 0, -120))

    const recs = c.engine.log.all().slice(before)
    const door = recs.filter((r) => r.spotLabel === "Bathroom door")
    expect(door.length >= 1, "a Bathroom door freeze was logged").toBe(true)
    const d = door[0].durationS
    report("C5 logged freezes: " + recs.map((r) => r.spotLabel + " " + r.durationS.toFixed(2) + " s (" + r.cause + ")").join("; "))
    expect(d > 2.0 && d < 5.0, "freeze duration is about the time stood still (" + d.toFixed(2) + " s)").toBe(true)

    const ix = new DefaultLeafInteractor()
    await waitUntil(() => c.ui.isPillShown, 5, "the pill after standing still")
    await ix.trigger(interactable("PillButton"))
    await waitUntil(() => c.ui.currentCard === "main", 2, "main card")
    await ix.trigger(interactable("TodayButton"))
    await waitUntil(() => c.ui.currentCard === "today", 2, "Today card")
    await sleep(200)

    const text = c.ui.todayText
    report("C5 Today card:\n" + text)
    expect(text.indexOf("Bathroom door") >= 0, "Today card names Bathroom door").toBe(true)
    expect(text.indexOf("Bathroom door   1 freeze, longest " + d.toFixed(1) + " s") >= 0, "Today card lists the door freeze with its duration " + d.toFixed(1) + " s").toBe(true)
    expect(text.indexOf("Most at: Bathroom door.") >= 0, "summary line names the door").toBe(true)

    await ix.trigger(interactable("CloseButton"))
    await waitUntil(() => c.ui.currentCard === "none", 2, "Today card closed")
    c.clearPoseOverride()
  }
}
