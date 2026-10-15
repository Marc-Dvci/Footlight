// Plain-number geometry shared by the Lens and the Node test harness.
// Units: centimetres and seconds. Lens Studio world axes: y is up, the floor is the x-z plane.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose {
  t: number; // seconds
  x: number; // cm
  y: number; // cm, height above the floor reference
  z: number; // cm
}

export function v2(x: number, z: number): Vec2 {
  return { x: x, z: z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: -1 };
}

/** Rotates a floor vector counter-clockwise (seen from above) by `rad`. */
export function rotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c + a.z * s, z: -a.x * s + a.z * c };
}

/** Yaw (rotation about +y, radians) that turns the Lens Studio forward axis (0,0,-1) onto `dir`. */
export function yawOf(dir: Vec2): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** Unit floor vector for a yaw, inverse of yawOf. */
export function dirOfYaw(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function floorOf(p: Pose): Vec2 {
  return { x: p.x, z: p.z };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
