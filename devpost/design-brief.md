---
status: approved
---

# Design brief: Footlight

## The one spatial moment
Jean, 71, has had Parkinson's for twelve years. Walking to the bathroom, his feet stop in the doorway as if glued to the floor. Within a second, bright amber lines roll out across the floor from just ahead of his toes, one per step at the length his physiotherapist set, running through the doorway, and a soft beat starts at his walking pace. He steps over the first line, then the next. Each line he crosses dims behind him, and once he is walking steadily the lines fade and the beat stops.

## Why it belongs on glasses
- Uses: draws in the world, leaves your body free, shares your view (head position and direction drive every decision).
- Why it's better than the phone or laptop version: the cue has to be on the floor in front of his feet, at the moment and in the place he freezes, while his hands hold a walker or a door frame. A phone cannot draw on the floor ahead of the feet while he walks. Families already stick tape across doorways; tape is always there (so it stops working) and is never where the next freeze happens.

## Product or overlay
- Type: overlay. It responds to the person's movement in their own home.
- What the real version would sense: head position from SPECS world tracking. A freeze is forward progress stopping after a walk had started; inside a marked freeze spot a short stop is enough, on open floor the stop must also show trembling in the 3-8 Hz band of head height.
- Stand-in for the preview: the preview has no real home and no trembling legs. (1) A simple stand-in home at real size (a hallway, a bathroom doorway 80 cm wide, a small bathroom) shows where the real walls and door would be; it is labelled `PreviewHome (stand-in)` and is hidden on device. (2) Freezes in the preview are stops inside a freeze spot, which the preview walk (WASD) produces directly. (3) The trembling test runs in code and in Node tests on scripted head traces; it is not part of any done criterion. (4) Pinch anywhere is the manual trigger.

## Where things live
- Where the user is looking during the main task: at the doorway and the floor ahead, head tilted down. SPECS shows about 37 deg vertically. With eyes 160 cm high and the view centred on the horizon, the nearest visible floor is about 4.8 m ahead; a 15 deg downward glance shows lines from about 2.4 m, and the lines at the toes need a look at the feet. That is why the lines run on through the doorway, why the beat starts with them, and why a chevron points down when the next line is out of view.
- Cue lines: flat on the floor (0.5 cm above it), 60 cm wide x 4 cm deep, warm amber (#FFC864), the first line 22 cm ahead of the head's floor point (12 cm toe offset + 10 cm gap), then one per target step (default 45 cm) along the walking direction. In a doorway they run square to the door through the opening and 60 cm past it. At most 7.
- Turn marks: on a 55 cm radius arc to the turning side, 45 cm wide, spaced at 0.8 x step, then two straight lines on the new heading.
- Look-down hint: a small amber chevron at the lower edge of view, shown only while lines exist and the first uncrossed line is outside the view.
- Footlight pill: a small round button (8 cm) that lazily follows at waist height, 55 cm ahead and 25 cm to the right, about 35 deg below eye level. Visible only when standing still with no cue showing.
- Main card (opened from the pill): 30 x 22 cm, 60 cm ahead at chest height, facing the user. Three big buttons: Set up home, Walk, Today.
- Setup reticle: a 40 cm ring on the floor where the head points (1 to 2.5 m ahead), with an arrow showing the spot's direction.
- Freeze spots (setup mode only): soft amber rings on the floor (radius = spot radius), with their label lying on the floor in large text.
- Today card: 36 x 26 cm, 70 cm ahead at chest height.

## Hands and input
- Pinch anywhere while walking: brings up straight lines at once, from where he stands (the manual trigger, SIK hand pinch).
- Pill: pinch to open the main card.
- Main card: three big buttons (Set up home, Walk, Today).
- Setup: big buttons on a setup card: Doorway, Turn left, Turn right, Narrow gap (each places a spot at the reticle, facing the way the carer faces), Undo, and two sliders: Step target (30 to 70 cm, default 45 cm) and Beat (80 to 120 per minute, default 100). Done returns to the main card.
- Today: Close button.
- Targets are big (at least 6 cm) and highlight when aimed at.
- Voice: none.

## When things show
- Cue lines: show on a freeze (stop in a spot after walking, a trembling stop on open floor, or a pinch). Crossed lines dim. All fade (0.8 s) once every line is crossed or after 1.5 s of steady walking past the last crossed line. They stay as long as he stays frozen. Automatic cues wait 2 s after the last fade (the pinch always works).
- Beat: starts with the lines, at the set tempo, keeps going for 2 beats into the fade, then stops.
- Look-down hint: only while lines show and the next line is out of view.
- Pill: only when standing still, no cue showing, card closed.
- Freeze spot rings: only in setup mode and on the Today card's map.
- Today card: on request. Shows count, longest and median freeze, and each spot with its count, plus a one-line summary ("3 freezes this session. Longest 4.2 s. Most at: Bathroom door.").
- If something needs attention out of view: the beat is audible wherever he looks; the chevron points to the lines.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. Walking (WASD) into the doorway spot and stopping brings up lines within 1 s; the first line is 22 cm ahead of the head's floor point and the lines run square through the doorway.
2. The spacing between lines equals the Step target slider value (moving the slider from 45 to 60 cm changes the spacing to 60 cm).
3. A pinch anywhere brings up lines at once, with the beat.
4. Walking on through the lines dims each crossed line, then the lines fade and the beat stops.
5. After a freeze and a restart, the Today card lists the freeze at "Bathroom door" with its duration.

## Out of scope
- Real recognition of doors and furniture (the carer marks spots).
- Memory between sessions (spots and the log reset when the Lens restarts).
- Sharing the log with a clinician.
- Fall detection or any medical claim. Footlight is a cueing aid.

## Risks and open questions
- Feel unproven: whether lines at the feet are visible enough given the narrow vertical view; whether amber on the additive display reads on real floors; whether head-height trembling is measurable during a real freeze (the Node evaluation uses body-worn sensors).
- Turning freezes respond better to sound than to visual cues in one AR study (Janssen 2020), so the beat leads in turns.
- Moving the camera for the demo film: if a scripted walk is used for repeatable footage, it must use the same detector path as WASD walking.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- The logic already exists as plain TypeScript in `Assets/Scripts/Core/` (FootlightEngine, FreezeDetector, CueGeometry, CueSequencer, SessionLog). It has Node tests in `tools/`. Do not reimplement it: write one component that feeds `FootlightEngine.step()` the camera's world position (cm) and yaw every frame and draws the returned lines, plays a beat on `frame.beat`, and calls `FootlightEngine.pinch()` on a SIK pinch.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
