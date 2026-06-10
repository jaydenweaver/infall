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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasm_ergosphere_radius: (a: number, b: number, c: number) => number;
    readonly wasm_event_horizon: (a: number, b: number) => number;
    readonly wasm_init: (a: number, b: number, c: number) => [number, number, number];
    readonly wasm_isco_radius: (a: number, b: number, c: number) => number;
    readonly wasm_step: (a: any, b: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
