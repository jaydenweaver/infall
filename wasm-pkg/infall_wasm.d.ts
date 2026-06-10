/* tslint:disable */
/* eslint-disable */

/**
 * Returns the ergosphere radius at a given polar angle θ (radians).
 */
export function wasm_ergosphere_radius(mass: number, spin: number, theta: number): number;

/**
 * Returns the outer event horizon radius for the given Kerr parameters.
 */
export function wasm_event_horizon(mass: number, spin: number): number;

/**
 * Initialise a new simulation state.
 *
 * # Arguments
 * * `mass`      — Black hole mass (geometrized units, typically 1.0).
 * * `spin`      — Spin parameter a ∈ [0, mass). Values ≥ mass are clamped.
 * * `initial_r` — Starting radial coordinate. Pass `NaN` or `0` to start at the prograde ISCO.
 *
 * # Returns
 * A `SimState` serialised as a JS object.
 */
export function wasm_init(mass: number, spin: number, initial_r: number): any;

/**
 * Returns the prograde ISCO radius for the given Kerr parameters.
 */
export function wasm_isco_radius(mass: number, spin: number, prograde: boolean): number;

/**
 * Advance the simulation by one proper-time step.
 *
 * # Arguments
 * * `state_js` — A `SimState` object previously returned by `wasm_init` or `wasm_step`.
 * * `dtau`     — Proper-time step size. Pass `NaN` or `0` for the default (1e-3 M).
 *                Scaled by `state.time_warp`.
 *
 * # Returns
 * A JS object `{ state: SimState, frame: FrameData }`, or `null` if terminated.
 */
export function wasm_step(state_js: any, dtau: number): any;
