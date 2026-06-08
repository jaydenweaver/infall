/**
 * Jest manual mock for the `infall-wasm` package.
 *
 * Real WASM can't execute in jsdom. This mock provides the same API shape
 * with predictable return values so hooks and components can be unit-tested.
 */

import type { SimState, FrameData, StepResult } from '@/lib/wasm-types';
import { PI_OVER_2 } from '@/lib/coordinates';

/** Default SimState used by wasm_init mock */
export const MOCK_INITIAL_STATE: SimState = {
  mass: 1.0,
  spin: 0.0,
  r: 6.0,
  theta: PI_OVER_2,
  phi: 0.0,
  r_dot: -1e-5,
  theta_dot: 0.0,
  proper_time: 0.0,
  energy: Math.sqrt(8 / 9),
  lz: 2 * Math.sqrt(3),
  carter: 0.0,
  time_warp: 1.0,
  terminated: false,
};

/** Default FrameData used by wasm_step mock */
export const MOCK_FRAME: FrameData = {
  r: 6.0,
  theta: PI_OVER_2,
  phi: 0.0,
  proper_time: 0.0,
  doppler_factor: 1.0,
  tetrad_r: [1 / 6, 0, 0],
  tetrad_theta: [0, 1 / 6, 0],
  tetrad_phi: [0, 0, 1 / 6],
  inside_horizon: false,
  terminated: false,
};

// Default mock — init returns the initial state, step advances r slightly
const defaultInit = jest.fn(
  (_mass: number, _spin: number, _r: number): SimState => ({
    ...MOCK_INITIAL_STATE,
  })
);

const defaultStep = jest.fn(
  (state: SimState, _dtau: number): StepResult | null => {
    if (state.terminated) return null;
    const next: SimState = {
      ...state,
      r: state.r - 1e-3,
      proper_time: state.proper_time + 1e-3,
      terminated: state.r - 1e-3 < 0.02,
    };
    const frame: FrameData = {
      ...MOCK_FRAME,
      r: next.r,
      proper_time: next.proper_time,
      inside_horizon: next.r < 2.0,
      terminated: next.terminated,
    };
    return { state: next, frame };
  }
);

export const wasm_init = defaultInit;
export const wasm_step = defaultStep;
export const wasm_event_horizon = jest.fn((_mass: number, _spin: number) => 2.0);
export const wasm_isco_radius = jest.fn((_mass: number, _spin: number, _pro: boolean) => 6.0);
export const wasm_ergosphere_radius = jest.fn(
  (_mass: number, _spin: number, _theta: number) => 2.0
);

/** Default export mirrors the wasm-bindgen init function (no-op in tests) */
export default jest.fn().mockResolvedValue(undefined);
