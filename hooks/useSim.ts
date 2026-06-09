'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WasmApi } from './useWasm';
import type { SimState, FrameData, BlackHoleParams } from '@/lib/wasm-types';

export interface SimControls {
  /** Advance the simulation by one step. Returns the new FrameData, or null if terminated. */
  step(): FrameData | null;
  /** Reset the simulation with the current (or new) params. */
  reset(params?: Partial<BlackHoleParams>): void;
  /** Current simulation state (ref — does not trigger re-renders). */
  stateRef: React.MutableRefObject<SimState | null>;
  /** Latest frame data (ref — does not trigger re-renders). */
  frameRef: React.MutableRefObject<FrameData | null>;
  /** Reactive snapshot of key display values, updated every N frames. */
  hudSnapshot: HudSnapshot | null;
}

export interface HudSnapshot {
  r: number;
  properTime: number;
  insideHorizon: boolean;
  terminated: boolean;
}

/** How many animation frames between HUD React state updates. */
const HUD_UPDATE_INTERVAL = 6;

/**
 * Manages the Kerr geodesic simulation state.
 *
 * Keeps `SimState` and `FrameData` in refs (not React state) so that the
 * animation loop can call `step()` at 60 fps without triggering re-renders.
 * Only the HUD snapshot (displayed text) is in React state, updated every
 * `HUD_UPDATE_INTERVAL` frames.
 */
export function useSim(api: WasmApi | null, params: BlackHoleParams): SimControls {
  const stateRef = useRef<SimState | null>(null);
  const frameRef = useRef<FrameData | null>(null);
  const frameCountRef = useRef(0);

  const [hudSnapshot, setHudSnapshot] = useState<HudSnapshot | null>(null);

  // (Re-)initialise whenever the API becomes available or params change
  useEffect(() => {
    if (!api) return;
    const r0 = isNaN(params.initialR) ? NaN : params.initialR * params.mass;
    const initial = api.wasm_init(params.mass, params.spin, r0);
    stateRef.current = initial;
    frameRef.current = null;
    frameCountRef.current = 0;
    setHudSnapshot({
      r: initial.r,
      properTime: 0,
      insideHorizon: false,
      terminated: false,
    });
  }, [api, params.mass, params.spin, params.initialR]);

  const step = useCallback((): FrameData | null => {
    if (!api || !stateRef.current || stateRef.current.terminated) return null;

    const result = api.wasm_step(stateRef.current, NaN);
    if (!result) return null;

    stateRef.current = result.state;
    frameRef.current = result.frame;

    // Throttle React state updates to avoid reconciliation on every frame
    frameCountRef.current += 1;
    if (frameCountRef.current % HUD_UPDATE_INTERVAL === 0) {
      setHudSnapshot({
        r: result.frame.r,
        properTime: result.frame.proper_time,
        insideHorizon: result.frame.inside_horizon,
        terminated: result.frame.terminated,
      });
    }

    return result.frame;
  }, [api]);

  const reset = useCallback(
    (overrides?: Partial<BlackHoleParams>) => {
      if (!api) return;
      const mass = overrides?.mass ?? params.mass;
      const spin = overrides?.spin ?? params.spin;
      const iR   = overrides?.initialR ?? params.initialR;
      const r0   = isNaN(iR) ? NaN : iR * mass;
      const initial = api.wasm_init(mass, spin, r0);
      stateRef.current = initial;
      frameRef.current = null;
      frameCountRef.current = 0;
      setHudSnapshot({
        r: initial.r,
        properTime: 0,
        insideHorizon: false,
        terminated: false,
      });
    },
    [api, params.mass, params.spin, params.initialR]
  );

  return { step, reset, stateRef, frameRef, hudSnapshot };
}
