// The one component that runs Footlight. Every frame it feeds FootlightEngine.step() the head's
// world position (cm) and yaw, draws the lines the engine returns, plays a click on each beat, and
// calls FootlightEngine.pinch() on a SIK pinch that is not aimed at a button.

import {InteractorInputType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import {SIK} from "SpectaclesInteractionKit.lspkg/SIK"
import {FootlightEngine, EngineFrame} from "./Core/FootlightEngine"
import {FreezeSpot, SpotKind} from "./Core/CueGeometry"
import {Pose, dirOfYaw, yawOf} from "./Core/FootlightMath"
import {summarySentence} from "./Core/SessionLog"
import {FootlightUI, TodayView} from "./FootlightUI"
import * as V from "./FootlightVisuals"

const FLOOR_LIFT_CM = 0.5 // all floor content sits this far above the floor
const MAX_LINES = 7

/** Default freeze spots, already placed so Walk mode works at once (stand-in home layout). */
export const DEFAULT_SPOTS: FreezeSpot[] = [
  {id: "bathroom-door", label: "Bathroom door", kind: "doorway", center: {x: 0, z: -300}, yaw: 0, radiusCm: 120},
  {id: "bathroom-turn", label: "Bathroom turn", kind: "turn", center: {x: 0, z: -420}, yaw: 0, radiusCm: 70, turnDeg: 180},
]

@component
export class FootlightController extends BaseScriptComponent {
  @ui.label("Footlight: floor cue lines and beat on a freezing of gait")
  @ui.separator
  @input
  @hint("The world camera object (head pose)")
  camera: SceneObject

  @input
  @hint("Base material for every glowing floor visual (Unlit, textured, normal blend)")
  glowMaterial: Material

  @input
  @hint("The beat: a quiet wooden click")
  clickTrack: AudioTrackAsset

  @input
  @hint("Panels")
  ui: FootlightUI

  @input
  @allowUndefined
  @hint("Stand-in home for the preview; hidden on device")
  previewHome: SceneObject

  @ui.group_start("Settings")
  @input
  @hint("Eye height above the floor, used until the floor is found (cm)")
  eyeHeightCm: number = 160

  @input
  @hint("Beat volume")
  @widget(new SliderWidget(0, 1, 0.05))
  beatVolume: number = 0.6

  @input
  @hint("Log engine events to the console")
  verbose: boolean = true
  @ui.group_end
  // ── State ────────────────────────────────────────────────────────────────
  readonly engine = new FootlightEngine()
  private camTr: Transform
  private cam: Camera
  private floorY = 0
  private floorKnown = false
  private floorSource = "none"
  private hitSession: HitTestSession | null = null
  private nextFloorProbe = 0
  private loggedFirstHit = false
  private lastGait = "standing"
  private stillSince = -1

  private poseOverride: {pos: vec3; yaw: number} | null = null
  private _lastFrame: EngineFrame | null = null
  private _beatCount = 0
  private _lastBeatT = -1
  private _pinchCount = 0
  private lastPinchT = -10
  private setupMode = false
  private spotSerial = 1

  private lines: V.Glow[] = []
  private chevron: V.Glow
  private chevronRoot: SceneObject
  private reticle: SceneObject
  private reticleRing: V.Glow
  private reticleArrow: V.Glow
  private spotRoot: SceneObject
  private beatObj: SceneObject
  private audio: AudioComponent
  private boundInteractors = new Set<Interactor>()
  private wasPinching: {[side: string]: boolean} = {left: false, right: false}
  private flat: RenderMesh
  private upright: RenderMesh
  private stripTex: Texture
  private ringTex: Texture

  onAwake(): void {
    // The default spots belong to the stand-in home; in any other room the carer marks them.
    if (this.previewHome && this.previewHome.isEnabledInHierarchy) {
      this.engine.setSpots(DEFAULT_SPOTS)
    }
    this.camTr = this.camera.getTransform()
    this.cam = this.camera.getComponent("Component.Camera") as Camera
    this.buildVisuals()
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart(): void {
    const onDevice = !global.deviceInfoSystem.isEditor()
    if (this.previewHome && onDevice) {
      this.previewHome.enabled = false
    }
    this.floorY = this.camTr.getWorldPosition().y - this.eyeHeightCm
    this.placeHome()
    try {
      const wq = require("LensStudio:WorldQueryModule") as WorldQueryModule
      const opts = HitTestSessionOptions.create()
      opts.filter = false
      this.hitSession = wq.createHitTestSessionWithOptions(opts)
      this.hitSession.start()
    } catch (e) {
      this.log("World Query unavailable: " + e)
    }
    this.ui.onOpenSetup.add(() => this.enterSetup())
    this.ui.onSetupDone.add(() => this.exitSetup())
    this.ui.onWalk.add(() => this.exitSetup())
    this.ui.onOpenToday.add(() => this.fillToday())
    this.ui.onPlaceSpot.add((k) => this.placeSpot(k))
    this.ui.onUndo.add(() => this.undoSpot())
    this.ui.onStepChange.add((cm) => this.setStepCm(cm))
    this.ui.onBeatChange.add((bpm) => this.setBeat(bpm))
    this.ui.onCardChanged.add((c) => {
      if (c === "none" && this.setupMode) {
        this.exitSetup()
      }
    })
    this.log("Footlight ready. floor y=" + this.floorY.toFixed(1) + " (camera start - " + this.eyeHeightCm + ")")
  }

  // ── Public API (tests, UI) ───────────────────────────────────────────────

  /** Test hook: when set, the engine uses this pose (world cm, yaw radians) instead of the camera. */
  setPoseOverride(pos: vec3, yawRad: number): void {
    this.poseOverride = {pos: pos, yaw: yawRad}
  }

  clearPoseOverride(): void {
    this.poseOverride = null
  }

  get lastFrame(): EngineFrame | null {
    return this._lastFrame
  }

  get beatCount(): number {
    return this._beatCount
  }

  get pinchCount(): number {
    return this._pinchCount
  }

  get floorHeight(): number {
    return this.floorY
  }

  get floorFoundBy(): string {
    return this.floorSource
  }

  get isSetupMode(): boolean {
    return this.setupMode
  }

  /** The line visuals, in plan order (only the first `lastFrame.lines.length` are in use). */
  get lineObjects(): SceneObject[] {
    return this.lines.map((l) => l.obj)
  }

  lineOpacity(i: number): number {
    return this.lines[i].obj.enabled ? this.lines[i].mat.mainPass.baseColor.w : 0
  }

  /** The pose the engine sees this frame (override or camera). */
  currentPose(): {pos: vec3; yaw: number} {
    if (this.poseOverride) {
      return this.poseOverride
    }
    return {pos: this.camTr.getWorldPosition(), yaw: this.headYaw()}
  }

  /** The manual trigger: lines at once from where the person stands. */
  pinchNow(): void {
    const t = getTime()
    if (t - this.lastPinchT < 0.25) {
      return
    }
    this.lastPinchT = t
    this._pinchCount++
    const f = this.engine.pinch(t)
    this.log("Pinch: " + (f.plan ? f.plan.mode + " cue, " + f.plan.lines.length + " lines" : "no plan"))
    this.apply(f)
  }

  setStepCm(cm: number): void {
    this.engine.setStepCm(Math.round(cm))
    this.ui.setStepCm(cm)
    this.log("Step target " + Math.round(cm) + " cm")
  }

  setBeat(bpm: number): void {
    this.engine.setCadence(Math.round(bpm))
    this.ui.setBeat(bpm)
    this.log("Beat " + Math.round(bpm) + " / min")
  }

  // ── Frame loop ───────────────────────────────────────────────────────────

  private onUpdate(): void {
    const t = getTime()
    this.bindInteractors()
    this.probeFloor(t)
    const p = this.currentPose()
    const pose: Pose = {t: t, x: p.pos.x, y: p.pos.y - this.floorY, z: p.pos.z}
    if (!this.setupMode) {
      const f = this.engine.step(pose, p.yaw)
      if (f.gait !== this.lastGait) {
        this.lastGait = f.gait
        this.log("Gait " + f.gait + " at z=" + p.pos.z.toFixed(0) + " (" + f.speedCmS.toFixed(0) + " cm/s)")
      }
      if (f.freeze) {
        this.log("Freeze (" + f.freeze.cause + ") at " + (f.spot ? f.spot.label : "open floor") + (f.newPlan ? "" : " (cooldown, logged only)"))
      }
      if (f.resume) {
        this.log("Walking again after " + f.resume.durationS.toFixed(1) + " s")
      }
      if (f.newPlan && f.plan) {
        this.log("Cue: " + f.plan.mode + ", " + f.plan.lines.length + " lines, first " + f.plan.lines[0].along.toFixed(1) + " cm ahead")
      }
      if (f.changed) {
        this.log("Cue state " + f.state)
      }
      this.apply(f)
      // Pill: standing still for a moment, no cue showing, card closed (the UI checks the card).
      if (f.speedCmS < 6) {
        if (this.stillSince < 0) {
          this.stillSince = t
        }
      } else {
        this.stillSince = -1
      }
      const still = this.stillSince >= 0 && t - this.stillSince >= 1.0 && f.gait !== "frozen"
      this.ui.setPillWanted(still && f.state === "hidden")
    } else {
      this.ui.setPillWanted(false)
      this.updateReticle()
    }
    this.updateBeatSource(p.pos)
  }

  private apply(f: EngineFrame): void {
    this._lastFrame = f
    const plan = f.plan
    for (let i = 0; i < MAX_LINES; i++) {
      const g = this.lines[i]
      const view = i < f.lines.length ? f.lines[i] : null
      if (!plan || !view || i >= plan.lines.length || view.opacity <= 0.003) {
        g.obj.enabled = false
        continue
      }
      const line = plan.lines[i]
      g.obj.enabled = true
      const tr = g.obj.getTransform()
      tr.setWorldPosition(new vec3(line.center.x, this.floorY + FLOOR_LIFT_CM, line.center.z))
      tr.setWorldRotation(quat.angleAxis(line.yaw, vec3.up()))
      // Lines roll out from the toes: a fresh line also grows to full width as it appears.
      const grow = !view.crossed && f.state === "cueing" ? 0.55 + 0.45 * view.opacity : 1
      tr.setLocalScale(new vec3((line.widthCm + 2 * V.STRIP_GLOW_CM) * grow, 1, V.STRIP_DEPTH_CM + 2 * V.STRIP_GLOW_CM))
      V.setOpacity(g, view.opacity)
    }
    if (f.beat) {
      this._beatCount++
      this._lastBeatT = getTime()
      if (this.audio.isPlaying()) {
        this.audio.stop(false)
      }
      this.audio.play(1)
    }
    this.updateChevron(f)
  }

  // ── Head pose ────────────────────────────────────────────────────────────

  private headYaw(): number {
    const back = this.camTr.forward
    const look = {x: -back.x, z: -back.z}
    if (Math.abs(look.x) + Math.abs(look.z) < 1e-4) {
      return 0
    }
    return yawOf(look)
  }

  // ── Floor ────────────────────────────────────────────────────────────────

  /**
   * World Query until a level surface below the head is found: straight down, and along rays just
   * inside the lower edge of view (the depth map only covers what the cameras see).
   */
  private probeFloor(t: number): void {
    if (this.floorKnown || !this.hitSession || t < this.nextFloorProbe) {
      return
    }
    this.nextFloorProbe = t + 0.5
    const head = this.camTr.getWorldPosition()
    const back = this.camTr.forward
    const look = new vec3(-back.x, -back.y, -back.z).normalize()
    const right = this.camTr.right
    const rays = [new vec3(0, -400, 0)]
    for (const deg of [10, 14, 17]) {
      rays.push(quat.angleAxis((-deg * Math.PI) / 180, right).multiplyVec3(look).uniformScale(1200))
    }
    for (const r of rays) {
      this.hitSession.hitTest(head, head.add(r), (hit: WorldQueryHitTestResult) => {
        if (this.floorKnown || !hit) {
          return
        }
        const drop = head.y - hit.position.y
        if (this.verbose && !this.loggedFirstHit) {
          this.loggedFirstHit = true
          this.log("First World Query hit: y=" + hit.position.y.toFixed(1) + " normal.y=" + hit.normal.y.toFixed(2))
        }
        if (hit.normal.y > 0.8 && drop > 80 && drop < 250) {
          this.floorKnown = true
          this.floorSource = "world query"
          this.floorY = hit.position.y
          this.placeHome()
          this.log("Floor found by World Query at y=" + this.floorY.toFixed(1) + " (" + drop.toFixed(0) + " cm below the head)")
        }
      })
    }
  }

  private placeHome(): void {
    if (this.previewHome) {
      const tr = this.previewHome.getTransform()
      const p = tr.getWorldPosition()
      tr.setWorldPosition(new vec3(p.x, this.floorY, p.z))
    }
    if (this.spotRoot) {
      const tr = this.spotRoot.getTransform()
      tr.setWorldPosition(new vec3(0, this.floorY + FLOOR_LIFT_CM, 0))
    }
  }

  // ── Visuals ──────────────────────────────────────────────────────────────

  private buildVisuals(): void {
    this.flat = V.floorQuad()
    this.upright = V.wallQuad()
    this.stripTex = V.stripTexture(60)
    this.ringTex = V.ringTexture(0.07, 0.05)
    const lineRoot = global.scene.createSceneObject("CueLines")
    lineRoot.setParent(this.sceneObject)
    for (let i = 0; i < MAX_LINES; i++) {
      const g = V.makeGlow(lineRoot, "CueLine_" + i, this.flat, this.glowMaterial, this.stripTex)
      g.obj.enabled = false
      this.lines.push(g)
    }

    // Look-down hint: a chevron at the lower edge of view, pointing at the lines.
    this.chevronRoot = global.scene.createSceneObject("LookDownHint")
    this.chevronRoot.setParent(this.camera)
    this.chevronRoot.getTransform().setLocalPosition(new vec3(0, -13, -60))
    this.chevron = V.makeGlow(this.chevronRoot, "Chevron", this.upright, this.glowMaterial, V.chevronTexture())
    this.chevron.obj.getTransform().setLocalScale(new vec3(4.5, 4.5, 1))
    this.chevronRoot.enabled = false

    // Setup reticle: a 40 cm ring on the floor with an arrow for the spot's direction.
    this.reticle = global.scene.createSceneObject("SetupReticle")
    this.reticle.setParent(this.sceneObject)
    this.reticleRing = V.makeGlow(this.reticle, "ReticleRing", this.flat, this.glowMaterial, V.ringTexture(0.1, 0.06))
    this.reticleRing.obj.getTransform().setLocalScale(new vec3(40, 1, 40))
    this.reticleArrow = V.makeGlow(this.reticle, "ReticleArrow", this.flat, this.glowMaterial, V.arrowTexture())
    this.reticleArrow.obj.getTransform().setLocalScale(new vec3(22, 1, 22))
    this.reticleArrow.obj.getTransform().setLocalPosition(new vec3(0, 0.1, 0))
    this.reticle.enabled = false

    this.spotRoot = global.scene.createSceneObject("FreezeSpots")
    this.spotRoot.setParent(this.sceneObject)
    this.spotRoot.enabled = false

    // The beat, spatialised at the feet.
    this.beatObj = global.scene.createSceneObject("BeatSource")
    this.beatObj.setParent(this.sceneObject)
    this.audio = this.beatObj.createComponent("Component.AudioComponent") as AudioComponent
    this.audio.audioTrack = this.clickTrack
    this.audio.volume = this.beatVolume
    try {
      this.audio.playbackMode = Audio.PlaybackMode.LowLatency
    } catch (e) {
      this.log("LowLatency playback unavailable: " + e)
    }
    try {
      this.audio.spatialAudio.enabled = true
      this.audio.spatialAudio.positionEffect.enabled = true
      this.audio.spatialAudio.distanceEffect.enabled = false
    } catch (e) {
      this.log("Spatial audio unavailable: " + e)
    }
  }

  private updateBeatSource(head: vec3): void {
    this.beatObj.getTransform().setWorldPosition(new vec3(head.x, this.floorY + 10, head.z))
  }

  /** Shown only while lines exist and none of the uncrossed lines is in view. */
  private updateChevron(f: EngineFrame): void {
    let target: vec3 | null = null
    let anyVisible = false
    if (f.plan && f.state !== "hidden") {
      for (let i = 0; i < f.lines.length && i < f.plan.lines.length; i++) {
        if (f.lines[i].crossed) {
          continue
        }
        const c = f.plan.lines[i].center
        const p = new vec3(c.x, this.floorY + FLOOR_LIFT_CM, c.z)
        if (target === null) {
          target = p
        }
        if (this.cam.isSphereVisible(p, 4)) {
          anyVisible = true
        }
      }
    }
    const show = target !== null && !anyVisible
    this.chevronRoot.enabled = show
    if (!show) {
      return
    }
    // Point the chevron toward the line, kept to the lower half (the lines are on the floor).
    const local = this.camTr.getInvertedWorldTransform().multiplyPoint(target)
    let ang = Math.atan2(local.x, -local.y) // 0 = straight down in view
    ang = Math.max(-1.2, Math.min(1.2, ang))
    const bob = Math.sin(getTime() * 6) * 0.8
    this.chevronRoot.getTransform().setLocalPosition(new vec3(Math.sin(ang) * 13, -Math.cos(ang) * 13 + bob, -60))
    this.chevronRoot.getTransform().setLocalRotation(quat.angleAxis(ang, vec3.forward()))
    V.setOpacity(this.chevron, 0.95)
  }

  // ── Setup mode ───────────────────────────────────────────────────────────

  private enterSetup(): void {
    this.setupMode = true
    this.reticle.enabled = true
    this.spotRoot.enabled = true
    this.rebuildSpotVisuals()
    this.ui.setStepCm(this.engine.getCueConfig().stepCm)
    this.ui.setBeat(this.engine.sequencer.getConfig().cadenceBpm)
    this.log("Setup mode")
  }

  private exitSetup(): void {
    if (!this.setupMode) {
      return
    }
    this.setupMode = false
    this.reticle.enabled = false
    this.spotRoot.enabled = false
    this.engine.detector.reset()
    this.log("Walk mode")
  }

  /** Where the head points on the floor, 1 to 2.5 m ahead. */
  private reticlePoint(): {pos: vec3; yaw: number} {
    const head = this.camTr.getWorldPosition()
    const back = this.camTr.forward
    const look = new vec3(-back.x, -back.y, -back.z)
    const flat = new vec3(look.x, 0, look.z)
    const fl = flat.length > 1e-3 ? flat.normalize() : new vec3(0, 0, -1)
    let dist = 250
    const h = head.y - this.floorY
    if (look.y < -1e-3) {
      dist = (h / -look.y) * flat.length
    }
    dist = Math.max(100, Math.min(250, dist))
    const p = head.add(fl.uniformScale(dist))
    return {pos: new vec3(p.x, this.floorY + FLOOR_LIFT_CM, p.z), yaw: yawOf({x: fl.x, z: fl.z})}
  }

  private updateReticle(): void {
    const r = this.reticlePoint()
    const tr = this.reticle.getTransform()
    tr.setWorldPosition(r.pos)
    tr.setWorldRotation(quat.angleAxis(r.yaw, vec3.up()))
  }

  private placeSpot(kind: SpotKind | "turnLeft" | "turnRight"): void {
    const r = this.reticlePoint()
    const base = kind === "doorway" ? "Doorway" : kind === "gap" ? "Gap" : "Turn"
    const n = this.engine.getSpots().filter((s) => s.label.indexOf(base + " ") === 0).length + 1
    const id = "spot-" + this.spotSerial++
    let spot: FreezeSpot
    if (kind === "turnLeft" || kind === "turnRight") {
      spot = {
        id: id,
        label: base + " " + n,
        kind: "turn",
        center: {x: r.pos.x, z: r.pos.z},
        yaw: r.yaw,
        radiusCm: 70,
        turnDeg: kind === "turnLeft" ? 90 : -90,
      }
    } else {
      spot = {
        id: id,
        label: base + " " + n,
        kind: kind,
        center: {x: r.pos.x, z: r.pos.z},
        yaw: r.yaw,
        radiusCm: kind === "doorway" ? 120 : 80,
      }
    }
    const spots = this.engine.getSpots()
    spots.push(spot)
    this.engine.setSpots(spots)
    this.rebuildSpotVisuals()
    this.log("Spot placed: " + spot.label + " at (" + spot.center.x.toFixed(0) + ", " + spot.center.z.toFixed(0) + ")")
  }

  private undoSpot(): void {
    const spots = this.engine.getSpots()
    const gone = spots.pop()
    this.engine.setSpots(spots)
    this.rebuildSpotVisuals()
    this.log(gone ? "Removed " + gone.label : "No spots to remove")
  }

  private rebuildSpotVisuals(): void {
    for (let i = this.spotRoot.getChildrenCount() - 1; i >= 0; i--) {
      this.spotRoot.getChild(i).destroy()
    }
    const spots = this.engine.getSpots()
    for (const s of spots) {
      const g = V.makeGlow(this.spotRoot, "Spot_" + s.id, this.flat, this.glowMaterial, this.ringTex)
      const tr = g.obj.getTransform()
      tr.setWorldPosition(new vec3(s.center.x, this.floorY + FLOOR_LIFT_CM, s.center.z))
      tr.setLocalScale(new vec3(s.radiusCm * 2, 1, s.radiusCm * 2))
      V.setOpacity(g, 0.75)
      // Label lying on the floor, readable when approaching along the spot's direction.
      const lab = global.scene.createSceneObject("SpotLabel_" + s.id)
      lab.setParent(this.spotRoot)
      const ltr = lab.getTransform()
      const dir = dirOfYaw(s.yaw)
      ltr.setWorldPosition(new vec3(s.center.x - dir.x * 20, this.floorY + FLOOR_LIFT_CM + 0.3, s.center.z - dir.z * 20))
      ltr.setWorldRotation(quat.angleAxis(s.yaw, vec3.up()).multiply(quat.angleAxis(-Math.PI / 2, vec3.right())))
      const t = lab.createComponent("Component.Text") as Text
      t.text = s.label
      t.size = 360
      t.depthTest = true
      t.textFill.color = new vec4(1, 0.86, 0.6, 0.95)
      t.horizontalAlignment = HorizontalAlignment.Center
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Overflow
    }
    const last = spots.length ? spots[spots.length - 1].label : ""
    this.ui.setSpotCount(spots.length, last)
  }

  // ── Today ────────────────────────────────────────────────────────────────

  private fillToday(): void {
    const log = this.engine.log
    const s = log.summary()
    const recs = log.all()
    const view: TodayView = {
      summary: summarySentence(s),
      freezes: String(s.freezes),
      longest: s.longestS.toFixed(1) + " s",
      median: s.medianS.toFixed(1) + " s",
      spots: s.bySpot.slice(0, 3).map((b) => b.label + "   " + b.count + (b.count === 1 ? " freeze" : " freezes") + ", longest " + b.longestS.toFixed(1) + " s"),
    }
    this.ui.showToday(view)
    this.log("Today: " + view.summary)
  }

  // ── Pinch anywhere ───────────────────────────────────────────────────────

  /**
   * The manual cue. A hand pinch (SIK hand pinch event) or an interactor trigger with no target
   * (the mouse in the preview) brings up lines, unless it is aimed at a button or a card is open.
   */
  private bindInteractors(): void {
    // Hand pinch: a rising edge of isPinching() on either hand.
    for (const side of ["left", "right"]) {
      const hand = SIK.HandInputData.getHand(side as any)
      const now = hand.isTracked() && hand.isPinching()
      if (now && !this.wasPinching[side]) {
        this.onFreePinch()
      }
      this.wasPinching[side] = now
    }
    const list = SIK.InteractionManager.getInteractorsByType(InteractorInputType.All)
    for (const it of list) {
      if (this.boundInteractors.has(it)) {
        continue
      }
      this.boundInteractors.add(it)
      it.onTriggerStart.add((target) => {
        if (target !== null && target !== undefined) {
          return // aimed at a button or slider
        }
        this.onFreePinch()
      })
    }
  }

  private onFreePinch(): void {
    if (this.setupMode || this.ui.currentCard !== "none") {
      this.log("Pinch ignored: " + (this.setupMode ? "setup mode" : "card " + this.ui.currentCard + " open"))
      return
    }
    for (const it of this.boundInteractors) {
      if (it.currentInteractable) {
        this.log("Pinch ignored: aimed at " + it.currentInteractable.sceneObject.name)
        return // the pinch is pressing a button or the pill
      }
    }
    this.pinchNow()
  }

  private log(msg: string): void {
    if (this.verbose) {
      print("[Footlight] " + msg)
    }
  }
}
