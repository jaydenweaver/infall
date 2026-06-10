/**
 * Jest manual mock for the `infall-wasm` package.
 *
 * Real WASM can't execute in jsdom. This mock provides the same API shape
 * with predictable return values so hooks and components can be unit-tested.
 *
 * Note: no path-alias imports here — __mocks__ files run in a special context
 * where module resolution may differ. Use plain relative imports or inline.
 */

const PI_OVER_2 = Math.PI / 2;

// Inline types to avoid @/ alias resolution issues in __mocks__
interface SimState {
  mass: number; spin: number;
  r: number; theta: number; phi: number;
  r_dot: number; theta_dot: number;
  proper_time: number;
  energy: number; lz: number; carter: number;
  time_warp: number; terminated: boolean;
}
interface FrameData {
  r: number; theta: number; phi: number; proper_time: number;
  doppler_factor: number;
  tetrad_r: [number, number, number];
  tetrad_theta: [number, number, number];
  tetrad_phi: [number, number, number];
  inside_horizon: boolean; terminated: boolean;
}

/** Default SimState used by wasm_init mock */
export const MOCK_INITIAL_STATE: SimState = {
  mass: 1.0, spin: 0.0,
  r: 6.0, theta: PI_OVER_2, phi: 0.0,
  r_dot: -1e-5, theta_dot: 0.0,
  proper_time: 0.0,
  energy: Math.sqrt(8 / 9), lz: 2 * Math.sqrt(3), carter: 0.0,
  time_warp: 1.0, terminated: false,
};

/** Default FrameData used by wasm_step mock */
export const MOCK_FRAME: FrameData = {
  r: 6.0, theta: PI_OVER_2, phi: 0.0, proper_time: 0.0,
  doppler_factor: 1.0,
  tetrad_r: [1 / 6, 0, 0],
  tetrad_theta: [0, 1 / 6, 0],
  tetrad_phi: [0, 0, 1 / 6],
  inside_horizon: false, terminated: false,
};

export const wasm_init = jest.fn(
  (_mass: number, _spin: number, _r: number): SimState => ({ ...MOCK_INITIAL_STATE })
);

export const wasm_step = jest.fn(
  (state: SimState, _dtau: number): { state: SimState; frame: FrameData } | null => {
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

export const wasm_event_horizon = jest.fn((_mass: number, _spin: number) => 2.0);
export const wasm_isco_radius = jest.fn(
  (_mass: number, _spin: number, _pro: boolean) => 6.0
);
export const wasm_ergosphere_radius = jest.fn(
  (_mass: number, _spin: number, _theta: number) => 2.0
);

/** Default export mirrors the wasm-bindgen init function (no-op in tests). */
export default jest.fn().mockResolvedValue(undefined);
