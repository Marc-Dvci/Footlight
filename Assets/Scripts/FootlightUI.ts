// Preload ThemeService before any UIKit visual (breaks a circular-import init-order crash in the
// package). Must remain the FIRST import.
import "SpectaclesUIKit.lspkg/Scripts/Themes/ThemeService"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {SpotKind} from "./Core/CueGeometry"

const IMAGE_MATERIAL: Material = requireAsset("../Materials/ImageMaterial.mat") as Material
const ICON_PILL: Texture = requireAsset("../Icons/footprint_hexffc864.png") as Texture
const ICON_HOME: Texture = requireAsset("../Icons/home.png") as Texture
const ICON_WALK: Texture = requireAsset("../Icons/directions_walk.png") as Texture
const ICON_TODAY: Texture = requireAsset("../Icons/today.png") as Texture

// ── Typography: the single source of truth for text size + weight ────────────
// `Component.Text.size` is the em-square height (cm = size / 43.886), calibrated at 110 cm.
const FONT_SIZE_SCALE = 1.0

type TextRole = "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2" | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}

function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

const LAYOUT_Z_LIFT = 0.02
const PANEL_CONTENT_Z = 0.6
const BUTTON_LABEL_Z = 0.08
const CONTROL_Z_LIFT = 0.05

// Panel distances and sizes from the brief (cm).
const MAIN_DIST = 60
const SETUP_DIST = 70
const TODAY_DIST = 70
const CHEST_DROP = 30 // chest height below the eyes

export type CardName = "none" | "main" | "setup" | "today"

export interface TodayView {
  summary: string // "3 freezes this session. Longest 4.2 s. Most at: Bathroom door."
  stats: string // "Freezes 3   Longest 4.2 s   Median 2.1 s"
  spots: string[] // "Bathroom door  2 freezes, longest 4.2 s"
  recent: string[] // "1. Bathroom door  2.3 s"
}

/**
 * Footlight's panels: the pill, the main card, the setup card and the Today card.
 * The controller pushes state in through the public methods and listens to the events.
 */
@component
export class FootlightUI extends BaseScriptComponent {
  @ui.label("Footlight UI: pill, main card, setup card, Today card")
  @ui.separator
  @input
  @hint("The world camera (head pose)")
  camera: SceneObject

  @ui.group_start("Settings")
  @input
  @hint("Text colour on the panels (keep light: the display is additive)")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(1, 1, 1, 1)

  @input
  @hint("Accent colour for values")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(1, 0.784, 0.392, 1)

  @input
  @hint("Seconds for a lazily-following panel to catch up")
  @widget(new SliderWidget(0.1, 2, 0.05))
  followSeconds: number = 0.6
  @ui.group_end
  private readonly _onOpenSetup = new Event<void>()
  private readonly _onWalk = new Event<void>()
  private readonly _onOpenToday = new Event<void>()
  private readonly _onPlaceSpot = new Event<SpotKind | "turnLeft" | "turnRight">()
  private readonly _onUndo = new Event<void>()
  private readonly _onSetupDone = new Event<void>()
  private readonly _onStepChange = new Event<number>()
  private readonly _onBeatChange = new Event<number>()
  private readonly _onCardChanged = new Event<CardName>()

  get onOpenSetup(): PublicApi<void> {
    return this._onOpenSetup.publicApi()
  }
  get onWalk(): PublicApi<void> {
    return this._onWalk.publicApi()
  }
  get onOpenToday(): PublicApi<void> {
    return this._onOpenToday.publicApi()
  }
  get onPlaceSpot(): PublicApi<SpotKind | "turnLeft" | "turnRight"> {
    return this._onPlaceSpot.publicApi()
  }
  get onUndo(): PublicApi<void> {
    return this._onUndo.publicApi()
  }
  get onSetupDone(): PublicApi<void> {
    return this._onSetupDone.publicApi()
  }
  get onStepChange(): PublicApi<number> {
    return this._onStepChange.publicApi()
  }
  get onBeatChange(): PublicApi<number> {
    return this._onBeatChange.publicApi()
  }
  get onCardChanged(): PublicApi<CardName> {
    return this._onCardChanged.publicApi()
  }

  private pill: SceneObject
  private mainCard: SceneObject
  private setupCard: SceneObject
  private todayCard: SceneObject
  private elements: {initialized: boolean}[] = []
  private ready = false
  private startT = -1

  private card: CardName = "none"
  private pillWanted = false
  private pillShown = false

  private stepSlider: Slider
  private beatSlider: Slider
  private stepText: Text
  private beatText: Text
  private spotCountText: Text
  private todaySummary: Text
  private todayStats: Text
  private todaySpots: Text
  private todayRecent: Text
  private mapRoot: SceneObject

  // Lazy follow state per panel.
  private follow = new Map<SceneObject, {pos: vec3; target: vec3; dist: number; right: number; drop: number}>()

  onAwake(): void {
    this.pill = this.buildPill()
    this.mainCard = this.buildMainCard()
    this.setupCard = this.buildSetupCard()
    this.todayCard = this.buildTodayCard()
    // Panels initialise while enabled, parked out of sight; they hide once every control is ready.
    for (const o of [this.pill, this.mainCard, this.setupCard, this.todayCard]) {
      o.getTransform().setWorldPosition(new vec3(0, -100000, 0))
    }
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ── Public API (controller → UI) ─────────────────────────────────────────

  get currentCard(): CardName {
    return this.card
  }

  get isReady(): boolean {
    return this.ready
  }

  get isPillShown(): boolean {
    return this.pillShown
  }

  /** The controller decides when the pill may show (standing still, no cue, card closed). */
  setPillWanted(wanted: boolean): void {
    this.pillWanted = wanted
  }

  openCard(name: CardName): void {
    if (name === this.card) {
      return
    }
    this.card = name
    this.mainCard.enabled = name === "main"
    this.setupCard.enabled = name === "setup"
    this.todayCard.enabled = name === "today"
    if (name === "main") {
      this.placeNow(this.mainCard)
    } else if (name === "setup") {
      this.placeNow(this.setupCard)
    } else if (name === "today") {
      this.placeNow(this.todayCard)
    }
    this._onCardChanged.invoke(name)
  }

  setStepCm(cm: number): void {
    if (this.stepText) {
      this.stepText.text = "Step target  " + Math.round(cm) + " cm"
    }
    if (this.stepSlider) {
      this.stepSlider.updateCurrentValue((cm - 30) / 40)
    }
  }

  setBeat(bpm: number): void {
    if (this.beatText) {
      this.beatText.text = "Beat  " + Math.round(bpm) + " / min"
    }
    if (this.beatSlider) {
      this.beatSlider.updateCurrentValue((bpm - 80) / 40)
    }
  }

  setSpotCount(n: number, last: string): void {
    if (this.spotCountText) {
      this.spotCountText.text = n + (n === 1 ? " spot" : " spots") + (last ? "  ·  last: " + last : "")
    }
  }

  showToday(v: TodayView): void {
    this.todaySummary.text = v.summary
    this.todayStats.text = v.stats
    this.todaySpots.text = v.spots.length ? v.spots.join("\n") : "No spots marked."
    this.todayRecent.text = v.recent.length ? v.recent.join("\n") : "No freezes yet."
  }

  /** Everything the Today card shows, as text (for tests and logs). */
  get todayText(): string {
    return [this.todaySummary.text, this.todayStats.text, this.todaySpots.text, this.todayRecent.text].join("\n")
  }

  get stepLabel(): string {
    return this.stepText ? this.stepText.text : ""
  }

  /** The map area on the Today card, for the controller to draw spot rings into (x-y plane, cm). */
  get todayMap(): SceneObject {
    return this.mapRoot
  }

  // ── Frame loop ───────────────────────────────────────────────────────────

  private onUpdate(): void {
    const t = getTime()
    if (!this.ready) {
      if (this.startT < 0) {
        this.startT = t
      }
      const allInit = this.elements.every((e) => e.initialized)
      if ((allInit && t - this.startT > 0.2) || t - this.startT > 3) {
        this.ready = true
        this.pill.enabled = false
        this.mainCard.enabled = false
        this.setupCard.enabled = false
        this.todayCard.enabled = false
      }
      return
    }
    const showPill = this.pillWanted && this.card === "none"
    if (showPill !== this.pillShown) {
      this.pillShown = showPill
      this.pill.enabled = showPill
      if (showPill) {
        this.placeNow(this.pill)
      }
    }
    const dt = getDeltaTime()
    for (const o of [this.pill, this.mainCard, this.setupCard, this.todayCard]) {
      if (o.enabled) {
        this.lazyFollow(o, dt)
      }
    }
  }

  // ── Placement ────────────────────────────────────────────────────────────

  private headBasis(): {head: vec3; fwd: vec3; right: vec3} {
    const tr = this.camera.getTransform()
    const head = tr.getWorldPosition()
    const back = tr.forward
    let fwd = new vec3(-back.x, 0, -back.z)
    if (fwd.length < 1e-3) {
      fwd = new vec3(0, 0, -1)
    }
    fwd = fwd.normalize()
    const right = new vec3(-fwd.z, 0, fwd.x)
    return {head: head, fwd: fwd, right: right}
  }

  private targetFor(o: SceneObject): vec3 {
    const f = this.follow.get(o)
    const b = this.headBasis()
    return b.head.add(b.fwd.uniformScale(f.dist)).add(b.right.uniformScale(f.right)).add(new vec3(0, -f.drop, 0))
  }

  private placeNow(o: SceneObject): void {
    const f = this.follow.get(o)
    const p = this.targetFor(o)
    f.pos = p
    f.target = p
    this.face(o, p)
  }

  /** Re-targets only when the head has turned or moved well away (lazy), then eases there. */
  private lazyFollow(o: SceneObject, dt: number): void {
    const f = this.follow.get(o)
    const want = this.targetFor(o)
    const head = this.headBasis().head
    const a = f.target.sub(head)
    const b = want.sub(head)
    const fa = new vec3(a.x, 0, a.z).normalize()
    const fb = new vec3(b.x, 0, b.z).normalize()
    const angle = Math.acos(Math.max(-1, Math.min(1, fa.dot(fb)))) * (180 / Math.PI)
    if (angle > 28 || want.distance(f.target) > 25) {
      f.target = want
    }
    const k = 1 - Math.exp(-dt / Math.max(0.05, this.followSeconds / 3))
    f.pos = vec3.lerp(f.pos, f.target, k)
    this.face(o, f.pos)
  }

  private face(o: SceneObject, p: vec3): void {
    const tr = o.getTransform()
    tr.setWorldPosition(p)
    const head = this.headBasis().head
    const toHead = head.sub(p)
    const flat = new vec3(toHead.x, 0, toHead.z)
    if (flat.length < 1e-3) {
      return
    }
    // Face the user, tilted back toward the eyes.
    tr.setWorldRotation(quat.lookAt(toHead.normalize(), vec3.up()))
  }

  // ── Builders ─────────────────────────────────────────────────────────────

  private buildPill(): SceneObject {
    const root = this.obj(this.sceneObject, "FootlightPill")
    root.createComponent("Component.Canvas")
    this.follow.set(root, {pos: vec3.zero(), target: vec3.zero(), dist: 55, right: 25, drop: 38})
    const btnObj = this.obj(root, "PillButton")
    const btn = btnObj.createComponent(Button.getTypeName()) as Button
    ;(btn as any)._themeOverride = "SnapOS2"
    ;(btn as any)._shapeSnapOS2 = "Round"
    ;(btn as any)._styleSnapOS2 = "PrimaryNeutral"
    btn.size = new vec3(8, 8, 1.5)
    this.elements.push(btn)
    this.addIcon(btnObj, ICON_PILL, 5, new vec3(0, 0, 0.9))
    btn.onTriggerUp.add(() => this.openCard("main"))
    return root
  }

  private buildMainCard(): SceneObject {
    const W = 30
    const H = 22
    const d = MAIN_DIST
    const {root, content} = this.panel("MainCard", W, H, MAIN_DIST)
    const col = this.flexColumn(content, W, H, {gap: 1.0, padX: 1.5, padY: 1.2, align: FlexAlign.Center})
    this.flexChild(col, {w: W - 3, h: 2.6}, (c) => this.text(c, "Footlight", "HeadlineXL", d, W - 3, this.textColor))
    this.flexChild(col, {w: W - 3, h: 14}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 14, {gap: 0.75, justify: FlexJustify.Center, align: FlexAlign.Center})
      const tiles: [string, Texture, () => void][] = [
        ["Set up home", ICON_HOME, () => this.goSetup()],
        ["Walk", ICON_WALK, () => this.goWalk()],
        ["Today", ICON_TODAY, () => this.goToday()],
      ]
      for (const [label, icon, fn] of tiles) {
        this.flexChild(row, {w: 8.5, h: 14}, (c) => this.tileButton(c, label, icon, 8.5, 14, d, fn))
      }
    })
    this.flexChild(col, {w: W - 3, h: 1.8}, (c) =>
      this.text(c, "Pinch anywhere for lines", "Caption", d, W - 3, new vec4(1, 1, 1, 0.6)),
    )
    return root
  }

  private buildSetupCard(): SceneObject {
    const W = 42
    const H = 31
    const d = SETUP_DIST
    const {root, content} = this.panel("SetupCard", W, H, SETUP_DIST, -24)
    const col = this.flexColumn(content, W, H, {gap: 0.8, padX: 1.5, padY: 1.2})
    this.flexChild(col, {w: W - 3, h: 2.4}, (c) => this.text(c, "Set up home", "HeadlineXL", d, W - 3, this.textColor))
    this.flexChild(col, {w: W - 3, h: 1.8}, (c) => {
      this.spotCountText = this.text(c, "Look at the floor spot, then choose its type", "Caption", d, W - 3, new vec4(1, 1, 1, 0.65))
    })
    this.flexChild(col, {w: W - 3, h: 7}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 7, {gap: 0.6, justify: FlexJustify.Center, align: FlexAlign.Center})
      const kinds: [string, SpotKind | "turnLeft" | "turnRight"][] = [
        ["Doorway", "doorway"],
        ["Turn left", "turnLeft"],
        ["Turn right", "turnRight"],
        ["Narrow gap", "gap"],
      ]
      for (const [label, kind] of kinds) {
        this.flexChild(row, {w: 9.2, h: 7}, (c) => this.textButton(c, label, 9.2, 7, d, "Headline2", () => this._onPlaceSpot.invoke(kind)))
      }
    })
    this.flexChild(col, {w: W - 3, h: 15}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 15, {gap: 1.0, align: FlexAlign.Center})
      this.flexChild(row, {w: 25, h: 15}, (sc) => {
        const sliders = this.flexColumn(sc, 25, 15, {gap: 0.6, justify: FlexJustify.Center})
        this.flexChild(sliders, {w: 25, h: 2}, (c) => {
          this.stepText = this.text(c, "Step target  45 cm", "Subheadline", d, 25, this.accentColor, true)
        })
        this.flexChild(sliders, {w: 25, h: 4.6}, (c) => {
          this.stepSlider = this.slider(c, "StepSlider", 25, 4.6, (45 - 30) / 40, (v) => {
            const cm = 30 + v * 40
            this.stepText.text = "Step target  " + Math.round(cm) + " cm"
            this._onStepChange.invoke(cm)
          })
        })
        this.flexChild(sliders, {w: 25, h: 2}, (c) => {
          this.beatText = this.text(c, "Beat  100 / min", "Subheadline", d, 25, this.accentColor, true)
        })
        this.flexChild(sliders, {w: 25, h: 4.6}, (c) => {
          this.beatSlider = this.slider(c, "BeatSlider", 25, 4.6, (100 - 80) / 40, (v) => {
            const bpm = 80 + v * 40
            this.beatText.text = "Beat  " + Math.round(bpm) + " / min"
            this._onBeatChange.invoke(bpm)
          })
        })
      })
      this.flexChild(row, {w: 13, h: 15}, (bc) => {
        const btns = this.flexColumn(bc, 13, 15, {gap: 1.0, justify: FlexJustify.Center})
        this.flexChild(btns, {w: 13, h: 6.5}, (c) => this.textButton(c, "Undo", 13, 6.5, d, "Headline1", () => this._onUndo.invoke()))
        this.flexChild(btns, {w: 13, h: 6.5}, (c) =>
          this.textButton(c, "Done", 13, 6.5, d, "Headline1", () => {
            this._onSetupDone.invoke()
            this.openCard("main")
          }),
        )
      })
    })
    return root
  }

  private buildTodayCard(): SceneObject {
    const W = 36
    const H = 26
    const d = TODAY_DIST
    const {root, content} = this.panel("TodayCard", W, H, TODAY_DIST)
    const col = this.flexColumn(content, W, H, {gap: 0.6, padX: 1.5, padY: 1.2})
    this.flexChild(col, {w: W - 3, h: 2.6}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 2.6, {justify: FlexJustify.SpaceBetween, align: FlexAlign.Center})
      this.flexChild(row, {w: 20, h: 2.6}, (c) => this.text(c, "Today", "HeadlineXL", d, 20, this.textColor, true))
    })
    this.flexChild(col, {w: W - 3, h: 3.2}, (c) => {
      this.todaySummary = this.text(c, "No freezes this session.", "Subheadline", d, W - 3, this.accentColor, true)
      this.todaySummary.verticalAlignment = VerticalAlignment.Center
    })
    this.flexChild(col, {w: W - 3, h: 1.8}, (c) => {
      this.todayStats = this.text(c, "Freezes 0", "Body", d, W - 3, this.textColor, true)
    })
    this.flexChild(col, {w: W - 3, h: 11.2}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 11.2, {gap: 1.0, align: FlexAlign.Start})
      this.flexChild(row, {w: 21, h: 11.2}, (lc) => {
        const lists = this.flexColumn(lc, 21, 11.2, {gap: 0.4})
        this.flexChild(lists, {w: 21, h: 5.2}, (c) => {
          this.todaySpots = this.text(c, "", "Body", d, 21, this.textColor, true)
          this.todaySpots.verticalAlignment = VerticalAlignment.Top
        })
        this.flexChild(lists, {w: 21, h: 5.6}, (c) => {
          this.todayRecent = this.text(c, "", "Body", d, 21, new vec4(1, 1, 1, 0.7), true)
          this.todayRecent.verticalAlignment = VerticalAlignment.Top
        })
      })
      this.flexChild(row, {w: 11, h: 11}, (mc) => {
        this.mapRoot = this.obj(mc, "TodayMap", new vec3(0, 0, 0.1))
      })
    })
    this.flexChild(col, {w: W - 3, h: 6.2}, (rowObj) => {
      const row = this.flexRow(rowObj, W - 3, 6.2, {justify: FlexJustify.End, align: FlexAlign.Center})
      this.flexChild(row, {w: 12, h: 6.2}, (c) => this.textButton(c, "Close", 12, 6.2, d, "Headline1", () => this.openCard("none")))
    })
    return root
  }

  private goSetup(): void {
    this.openCard("setup")
    this._onOpenSetup.invoke()
  }

  private goWalk(): void {
    this.openCard("none")
    this._onWalk.invoke()
  }

  private goToday(): void {
    this._onOpenToday.invoke()
    this.openCard("today")
  }

  // ── Composition helpers ──────────────────────────────────────────────────

  private panel(name: string, w: number, h: number, dist: number, right: number = 0): {root: SceneObject; content: SceneObject} {
    const root = this.obj(this.sceneObject, name)
    root.createComponent("Component.Canvas")
    this.follow.set(root, {pos: vec3.zero(), target: vec3.zero(), dist: dist, right: right, drop: CHEST_DROP})
    const plateObj = this.obj(root, name + "Plate")
    const plate = plateObj.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.style = "dark"
    plate.size = new vec2(w, h)
    const content = this.obj(root, "Content", new vec3(0, 0, PANEL_CONTENT_Z))
    return {root: root, content: content}
  }

  private text(parent: SceneObject, s: string, role: TextRole, dist: number, widthCm: number, color: vec4, left: boolean = false): Text {
    const so = this.obj(parent, "Text", new vec3(0, 0, 0.15))
    const t = so.createComponent("Component.Text") as Text
    t.text = s
    t.depthTest = true
    applyTextRole(t, role, dist)
    t.textFill.color = color
    t.horizontalAlignment = left ? HorizontalAlignment.Left : HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Wrap
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCm / 2, widthCm / 2, -1.2, 1.2)
    return t
  }

  private textButton(parent: SceneObject, label: string, w: number, h: number, dist: number, role: TextRole, fn: () => void): Button {
    const so = this.obj(parent, label.replace(/ /g, "") + "Button", new vec3(0, 0, CONTROL_Z_LIFT))
    const btn = so.createComponent(Button.getTypeName()) as Button
    ;(btn as any)._themeOverride = "SnapOS2"
    btn.size = new vec3(w, h, 1)
    this.elements.push(btn)
    const lab = this.obj(so, "ButtonLabel", new vec3(0, 0, BUTTON_LABEL_Z + 0.5))
    const t = lab.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, role, dist)
    t.textFill.color = this.textColor
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Wrap
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-(w - 0.6) / 2, (w - 0.6) / 2, -h / 2, h / 2)
    btn.onTriggerUp.add(fn)
    return btn
  }

  private tileButton(parent: SceneObject, label: string, icon: Texture, w: number, h: number, dist: number, fn: () => void): Button {
    const so = this.obj(parent, label.replace(/ /g, "") + "Button", new vec3(0, 0, CONTROL_Z_LIFT))
    const btn = so.createComponent(Button.getTypeName()) as Button
    ;(btn as any)._themeOverride = "SnapOS2"
    btn.size = new vec3(w, h, 1)
    this.elements.push(btn)
    this.addIcon(so, icon, 4.6, new vec3(0, h * 0.16, BUTTON_LABEL_Z + 0.5))
    const lab = this.obj(so, "ButtonLabel", new vec3(0, -h * 0.25, BUTTON_LABEL_Z + 0.5))
    const t = lab.createComponent("Component.Text") as Text
    t.text = label
    t.depthTest = true
    applyTextRole(t, "Headline1", dist)
    t.textFill.color = this.textColor
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Wrap
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-(w - 0.6) / 2, (w - 0.6) / 2, -2.4, 2.4)
    btn.onTriggerUp.add(fn)
    return btn
  }

  private addIcon(parent: SceneObject, tex: Texture, sizeCm: number, pos: vec3): void {
    const so = this.obj(parent, "Icon", pos)
    so.getTransform().setLocalScale(new vec3(sizeCm, sizeCm, 1))
    const img = so.createComponent("Component.Image") as Image
    const mat = IMAGE_MATERIAL.clone()
    mat.mainPass.baseTex = tex
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
  }

  private slider(parent: SceneObject, name: string, w: number, h: number, initial: number, onChange: (v: number) => void): Slider {
    const so = this.obj(parent, name, new vec3(0, 0, CONTROL_Z_LIFT))
    const s = so.createComponent(Slider.getTypeName()) as Slider
    ;(s as any)._themeOverride = "SnapOS2"
    ;(s as any)._size = new vec3(w, h, 1)
    ;(s as any)._segmented = true
    ;(s as any)._numberOfSegments = 9
    ;(s as any)._defaultValue = initial
    s.initialize()
    s.updateCurrentValue(initial)
    this.elements.push(s)
    s.onValueChange.add((v: number) => onChange(v))
    return s
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    if (position) {
      so.getTransform().setLocalPosition(position)
    }
    return so
  }

  private liftInZ(so: SceneObject, z: number): void {
    const t = so.getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x, p.y, p.z + z))
  }

  private flexColumn(
    parent: SceneObject,
    width: number,
    height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign},
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Column, width, height, opts)
  }

  private flexRow(
    parent: SceneObject,
    width: number,
    height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign},
  ): SceneObject {
    return this.makeFlex(parent, FlexDirection.Row, width, height, opts)
  }

  private makeFlex(
    parent: SceneObject,
    direction: FlexDirection,
    width: number,
    height: number,
    opts?: {gap?: number; padY?: number; padX?: number; justify?: FlexJustify; align?: FlexAlign},
  ): SceneObject {
    const container = this.obj(parent, "Flex")
    this.liftInZ(container, LAYOUT_Z_LIFT)
    const fl = container.createComponent(FlexLayout.getTypeName()) as FlexLayout
    fl.autoDiscoverItemsOnStart = false
    const fi = container.createComponent(FlexItem.getTypeName()) as FlexItem
    if (width > 0) fi.overrideWidth = width
    if (height > 0) fi.overrideHeight = height
    fl.onInitialized.add(() => {
      fl.width = width
      fl.height = height
      fl.direction = direction
      if (direction === FlexDirection.Row) {
        fl.columnGap = opts?.gap ?? 0
      } else {
        fl.rowGap = opts?.gap ?? 0
      }
      fl.paddingTop = opts?.padY ?? 0
      fl.paddingBottom = opts?.padY ?? 0
      fl.paddingLeft = opts?.padX ?? 0
      fl.paddingRight = opts?.padX ?? 0
      fl.justifyContent = opts?.justify ?? FlexJustify.Start
      fl.alignItems = opts?.align ?? FlexAlign.Stretch
    })
    return container
  }

  private flexChild(parent: SceneObject, size: {w?: number; h?: number; grow?: number}, builder: (child: SceneObject) => void): SceneObject {
    const child = this.obj(parent, "Item")
    this.liftInZ(child, LAYOUT_Z_LIFT)
    const fi = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) fi.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) fi.overrideHeight = size.h
    fi.flexGrow = size.grow ?? 0
    fi.flexShrink = 0
    builder(child)
    const parentFl = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFl) {
      parentFl.addItems([fi])
    }
    return child
  }
}
