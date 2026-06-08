/**
 * Coordinate utilities for the Infall simulator.
 *
 * Bridges Boyer-Lindquist (BL) coordinates used by the physics engine and
 * the Three.js Cartesian world space used by the renderer.
 *
 * Convention:
 *   - BL θ ∈ [0, π]:  0 = north pole, π/2 = equatorial, π = south pole
 *   - Cartesian Y-axis = BL polar axis (θ = 0 → +Y)
 *   - WORLD_SCALE: 1 geometrized mass unit M → WORLD_SCALE Three.js units
 */

export const WORLD_SCALE = 100; // 1 M = 100 Three.js units
export const PI_OVER_2 = Math.PI / 2;

/** Radius of the procedural star sphere in Three.js world units. */
export const STAR_SPHERE_RADIUS = 8_000_000; // ~80 000 M from the BH

/**
 * Convert Boyer-Lindquist (r, θ, φ) to Three.js Cartesian (x, y, z).
 *
 * x = r sinθ cosφ
 * y = r cosθ         ← polar axis
 * z = r sinθ sinφ
 */
export function blToCartesian(
  r: number,
  theta: number,
  phi: number
): [number, number, number] {
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const x = r * sinT * Math.cos(phi) * WORLD_SCALE;
  const y = r * cosT * WORLD_SCALE;
  const z = r * sinT * Math.sin(phi) * WORLD_SCALE;
  return [x, y, z];
}

/**
 * Cartesian distance of a BL point from the origin (= r * WORLD_SCALE).
 * Useful for sanity-checking blToCartesian.
 */
export function blRadius(r: number): number {
  return r * WORLD_SCALE;
}

/**
 * Camera "up" vector in Three.js world space for an observer at (r, θ, φ).
 *
 * We use the BL θ̂ direction (pointing toward the south pole / increasing θ)
 * projected into Cartesian. At equatorial θ = π/2 this gives (0, -1, 0).
 * We negate it so "up" points toward the north pole (0, +1, 0) at equatorial.
 *
 * Returns a normalised [x, y, z] vector.
 */
export function cameraUp(theta: number, phi: number): [number, number, number] {
  // The negated ∂/∂θ direction in Cartesian space, pointing "up" (toward north pole):
  //   ∂(x,y,z)/∂θ = (r cosθ cosφ, -r sinθ, r cosθ sinφ)  [normalised — r cancels]
  //   negated: (-cosθ cosφ, sinθ, -cosθ sinφ)
  //
  // This vector is always unit length:
  //   |up|² = cos²θ cos²φ + sin²θ + cos²θ sin²φ = cos²θ + sin²θ = 1
  //
  // At equatorial (θ=π/2):  up = (0, 1, 0)   ← world Y, intuitive "up"
  // At north pole  (θ=0):   up = (-cosφ, 0, -sinφ)  ← in-plane direction
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return [-(cosT * Math.cos(phi)), sinT, -(cosT * Math.sin(phi))];
}

/**
 * Generate `count` random points uniformly distributed on a sphere of
 * radius `r`, returned as a flat Float32Array of [x, y, z, x, y, z, ...].
 *
 * Uses the Marsaglia / spherical-coordinates method for uniform distribution.
 */
export function randomStarPositions(count: number, r: number): Float32Array {
  const buf = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform point on sphere: θ = arccos(1 - 2u), φ = 2πv
    const u = Math.random();
    const v = Math.random();
    const theta = Math.acos(1 - 2 * u);
    const phi = 2 * Math.PI * v;
    buf[i * 3] = r * Math.sin(theta) * Math.cos(phi);
    buf[i * 3 + 1] = r * Math.cos(theta);
    buf[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
  }
  return buf;
}
