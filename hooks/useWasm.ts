'use client';

import { useEffect, useState } from 'react';
import type { SimState, FrameData, StepResult } from '@/lib/wasm-types';

/**
 * Typed wrapper around the wasm-bindgen exports.
 * Matches the signatures in wasm/src/lib.rs and the generated .d.ts.
 */
export interface WasmApi {
  wasm_init(mass: number, spin: number, initial_r: number): SimState;
  wasm_step(state: SimState, dtau: number): StepResult | null;
  wasm_event_horizon(mass: number, spin: number): number;
  wasm_isco_radius(mass: number, spin: number, prograde: boolean): number;
  wasm_ergosphere_radius(mass: number, spin: number, theta: number): number;
}

export interface UseWasmResult {
  /** True once the WASM module is loaded and ready to call. */
  ready: boolean;
  /** The WASM API, or null while loading. */
  api: WasmApi | null;
  /** Non-null if loading failed. */
  error: Error | null;
}

/**
 * Asynchronously loads the infall-wasm module.
 *
 * Must be used in a `'use client'` component. The import is deferred to
 * `useEffect` so it never runs on the server (WASM requires a browser env).
 */
export function useWasm(): UseWasmResult {
  const [state, setState] = useState<UseWasmResult>({
    ready: false,
    api: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Dynamic import defers WASM loading to the client; webpack's
        // asyncWebAssembly experiment handles the .wasm instantiation.
        const mod = await import('infall-wasm');

        // wasm-bindgen bundler target: default export is the async init fn
        const initFn = mod.default as unknown as (() => Promise<void>) | undefined;
        if (typeof initFn === 'function') {
          await initFn();
        }

        if (!cancelled) {
          setState({ ready: true, api: mod as unknown as WasmApi, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error('[useWasm] Failed to load WASM module:', error);
          setState({ ready: false, api: null, error });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
