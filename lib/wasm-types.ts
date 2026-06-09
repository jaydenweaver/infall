/**
 * TypeScript mirror of the Rust types in wasm/src/types.rs.
 *
 * Keep in sync with the Rust definitions. The WASM serialisation
 * (serde-wasm-bindgen) produces plain JS objects matching these shapes.
 */

/** Full simulation state — passed back to WASM each tick via wasm_step. */
export interface SimState {
  // Black hole parameters
  mass: number;
  spin: number;

  // Observer position (Boyer-Lindquist coordinates)
  r: number;
  theta: number; // radians; π/2 = equatorial
  phi: number;   // radians; ingoing Kerr φ̃ near/inside horizon

  // Observer velocity (dr/dτ, dθ/dτ)
  r_dot: number;
  theta_dot: number;

  // Proper time elapsed
  proper_time: number;

  // Conserved quantities (held constant by integrator)
  energy: number;
  lz: number;
  carter: number;

  // Integration control
  time_warp: number;
  terminated: boolean;
}

/** Per-frame output from wasm_step — consumed by the renderer. */
export interface FrameData {
  r: number;
  theta: number;
  phi: number;
  proper_time: number;

  /** Relativistic Doppler factor (isotropic approximation). */
  doppler_factor: number;

  /**
   * Local orthonormal tetrad basis vectors in BL coordinates.
   * Each is a 3-vector [dr-component, dθ-component, dφ-component].
   * The renderer uses these to orient the camera and compute aberration.
   */
  tetrad_r: [number, number, number];
  tetrad_theta: [number, number, number];
  tetrad_phi: [number, number, number];

  /** True once the observer has crossed the outer event horizon. */
  inside_horizon: boolean;
  terminated: boolean;
}

/** Return value of wasm_step. */
export interface StepResult {
  state: SimState;
  frame: FrameData;
}

/** Black hole parameters passed to wasm_init. */
export interface BlackHoleParams {
  /** Black hole mass in geometrized units. Default: 1.0. */
  mass: number;
  /** Spin parameter a ∈ [0, mass). */
  spin: number;
  /** Initial observer distance in multiples of M (BL r / mass). NaN → ISCO. */
  initialR: number;
}

export const DEFAULT_PARAMS: BlackHoleParams = {
  mass: 1.0,
  spin: 0.0,
  initialR: 8,
};
