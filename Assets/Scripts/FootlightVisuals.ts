// Procedural looks for everything Footlight draws in the world: the amber cue strips, the soft
// rings for freeze spots and the setup reticle, the look-down chevron and the direction arrow.
// Textures are painted once at start, so the look is tunable here without image assets.

export const AMBER = new vec3(1.0, 200 / 255, 100 / 255) // #FFC864

/** Physical layout of the cue strip texture, in cm. The quad is the strip plus a glow margin. */
export const STRIP_GLOW_CM = 6
export const STRIP_DEPTH_CM = 4

type Painter = (u: number, v: number) => [number, number, number, number] // straight rgba 0..1

function paint(w: number, h: number, painter: Painter): Texture {
  const tex = ProceduralTextureProvider.createWithFormat(w, h, TextureFormat.RGBA8Unorm)
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = painter((x + 0.5) / w, (y + 0.5) / h)
      const i = (y * w + x) * 4
      px[i] = Math.round(clamp01(c[0]) * 255)
      px[i + 1] = Math.round(clamp01(c[1]) * 255)
      px[i + 2] = Math.round(clamp01(c[2]) * 255)
      px[i + 3] = Math.round(clamp01(c[3]) * 255)
    }
  }
  ;(tex.control as ProceduralTextureProvider).setPixels(0, 0, w, h, px)
  return tex
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Core over glow, both amber; the core has a warmer-white hot centre line. */
function compose(core: number, glow: number, hot: number): [number, number, number, number] {
  const a = core + glow * (1 - core)
  if (a <= 1e-4) {
    return [AMBER.x, AMBER.y, AMBER.z, 0]
  }
  const cr = AMBER.x
  const cg = AMBER.y + (0.93 - AMBER.y) * hot
  const cb = AMBER.z + (0.75 - AMBER.z) * hot
  const gr = 1.0
  const gg = 0.68
  const gb = 0.3
  const wc = core / a
  const wg = (glow * (1 - core)) / a
  return [cr * wc + gr * wg, cg * wc + gg * wg, cb * wc + gb * wg, a]
}

/**
 * The cue strip: a 60 x 4 cm emissive bar whose ends taper softly, with a faint glow around it.
 * `widthCm` is the strip length across the walking direction.
 */
export function stripTexture(widthCm: number): Texture {
  const W = widthCm + 2 * STRIP_GLOW_CM
  const D = STRIP_DEPTH_CM + 2 * STRIP_GLOW_CM
  const half = widthCm / 2
  return paint(288, 64, (u, v) => {
    const x = (u - 0.5) * W
    const z = (v - 0.5) * D
    const ax = Math.abs(x)
    const az = Math.abs(z)
    // Soft ends: the last 7 cm of each end fade out, and the ends round off.
    const endFade = smooth(0, 7, half - ax)
    const edge = smooth(STRIP_DEPTH_CM / 2 + 0.35, STRIP_DEPTH_CM / 2 - 0.35, az)
    const core = endFade * edge
    const hot = smooth(1.2, 0.0, az) * endFade
    const dx = Math.max(ax - (half - 4), 0)
    const dz = Math.max(az - STRIP_DEPTH_CM / 2, 0)
    const d = Math.sqrt(dx * dx + dz * dz)
    const border = smooth(0, 1.5, Math.min(W / 2 - ax, D / 2 - az))
    const glow = 0.32 * Math.exp(-d / 2.0) * border
    return compose(core, glow, hot)
  })
}

/** A soft ring whose band sits just inside the quad edge, with a faint fill to show the area. */
export function ringTexture(bandFrac: number, fillAlpha: number): Texture {
  return paint(256, 256, (u, v) => {
    const r = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5)) * 2 // 0 centre, 1 edge
    const mid = 0.93 - bandFrac / 2
    const dist = Math.abs(r - mid)
    const core = smooth(bandFrac / 2 + 0.012, bandFrac / 2 - 0.012, dist)
    const glow = 0.3 * Math.exp(-dist / 0.035) * smooth(1.0, 0.97, r)
    const fill = r < mid ? fillAlpha : 0
    return compose(core, Math.max(glow, fill), 0.2 * core)
  })
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy))
  const dx = px - (ax + vx * t)
  const dy = py - (ay + vy * t)
  return Math.sqrt(dx * dx + dy * dy)
}

function strokes(segs: number[][], thick: number): Texture {
  return paint(128, 128, (u, v) => {
    const x = u * 2 - 1
    const y = v * 2 - 1
    let d = 1e9
    for (const s of segs) {
      d = Math.min(d, segDist(x, y, s[0], s[1], s[2], s[3]))
    }
    const core = smooth(thick + 0.03, thick - 0.03, d)
    const glow = 0.35 * Math.exp(-Math.max(0, d - thick) / 0.08) * smooth(1, 0.9, Math.max(Math.abs(x), Math.abs(y)))
    return compose(core, glow, 0.3 * core)
  })
}

/** A chevron pointing toward -v (down on a quad whose +v is up). */
export function chevronTexture(): Texture {
  return strokes(
    [
      [-0.6, 0.25, 0, -0.35],
      [0, -0.35, 0.6, 0.25],
    ],
    0.11,
  )
}

/** An arrow pointing toward +v. */
export function arrowTexture(): Texture {
  return strokes(
    [
      [0, -0.75, 0, 0.62],
      [-0.42, 0.22, 0, 0.7],
      [0.42, 0.22, 0, 0.7],
    ],
    0.09,
  )
}

/** Unit quad lying in the x-z plane (normal +y), uv v grows toward -z. */
export function floorQuad(): RenderMesh {
  return quad(true)
}

/** Unit quad standing in the x-y plane (normal +z), uv v grows toward +y. */
export function wallQuad(): RenderMesh {
  return quad(false)
}

function quad(flat: boolean): RenderMesh {
  const b = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3},
    {name: "texture0", components: 2},
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  if (flat) {
    // prettier-ignore
    b.appendVerticesInterleaved([
      -0.5, 0, 0.5, 0, 1, 0, 0, 0,
      0.5, 0, 0.5, 0, 1, 0, 1, 0,
      0.5, 0, -0.5, 0, 1, 0, 1, 1,
      -0.5, 0, -0.5, 0, 1, 0, 0, 1,
    ])
  } else {
    // prettier-ignore
    b.appendVerticesInterleaved([
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
      0.5, -0.5, 0, 0, 0, 1, 1, 0,
      0.5, 0.5, 0, 0, 0, 1, 1, 1,
      -0.5, 0.5, 0, 0, 0, 1, 0, 1,
    ])
  }
  b.appendIndices([0, 1, 2, 0, 2, 3])
  b.updateMesh()
  return b.getMesh()
}

/** A visual with its own material instance, so its opacity can change on its own. */
export interface Glow {
  obj: SceneObject
  rmv: RenderMeshVisual
  mat: Material
}

export function makeGlow(parent: SceneObject, name: string, mesh: RenderMesh, base: Material, tex: Texture): Glow {
  const obj = global.scene.createSceneObject(name)
  obj.setParent(parent)
  const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  const mat = base.clone()
  mat.mainPass.baseTex = tex
  mat.mainPass.baseColor = new vec4(1, 1, 1, 1)
  rmv.mainMaterial = mat
  return {obj: obj, rmv: rmv, mat: mat}
}

export function setOpacity(g: Glow, a: number): void {
  g.mat.mainPass.baseColor = new vec4(1, 1, 1, a)
}
