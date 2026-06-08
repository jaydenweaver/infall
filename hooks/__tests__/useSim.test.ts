import { renderHook, act, waitFor } from '@testing-library/react';
import { useSim } from '../useSim';
import type { WasmApi } from '../useWasm';
import {
  wasm_init,
  wasm_step,
  wasm_event_horizon,
  wasm_isco_radius,
  wasm_ergosphere_radius,
  MOCK_INITIAL_STATE,
  MOCK_FRAME,
} from '../../__mocks__/infall-wasm';

const mockApi: WasmApi = {
  wasm_init: wasm_init as unknown as WasmApi['wasm_init'],
  wasm_step: wasm_step as unknown as WasmApi['wasm_step'],
  wasm_event_horizon: wasm_event_horizon as unknown as WasmApi['wasm_event_horizon'],
  wasm_isco_radius: wasm_isco_radius as unknown as WasmApi['wasm_isco_radius'],
  wasm_ergosphere_radius: wasm_ergosphere_radius as unknown as WasmApi['wasm_ergosphere_radius'],
};

const defaultParams = { mass: 1.0, spin: 0.0 };

describe('useSim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initialises sim state when API is provided', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    expect(wasm_init).toHaveBeenCalledWith(1.0, 0.0, NaN);
    expect(result.current.stateRef.current).toMatchObject({ r: 6.0 });
  });

  it('does not call wasm_init when api is null', () => {
    renderHook(() => useSim(null, defaultParams));
    expect(wasm_init).not.toHaveBeenCalled();
  });

  it('step() calls wasm_step and returns frame data', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    let frame: ReturnType<typeof result.current.step>;
    act(() => {
      frame = result.current.step();
    });

    expect(wasm_step).toHaveBeenCalled();
    expect(frame).not.toBeNull();
    expect(frame!.r).toBeLessThan(6.0); // r decreases
  });

  it('step() returns null when terminated', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    // Force terminated state
    result.current.stateRef.current!.terminated = true;

    let frame: ReturnType<typeof result.current.step>;
    act(() => {
      frame = result.current.step();
    });

    expect(frame).toBeNull();
  });

  it('step() returns null when api is null', () => {
    const { result } = renderHook(() => useSim(null, defaultParams));

    let frame: ReturnType<typeof result.current.step>;
    act(() => {
      frame = result.current.step();
    });

    expect(frame).toBeNull();
  });

  it('frameRef updates after step()', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    expect(result.current.frameRef.current).toBeNull();

    act(() => {
      result.current.step();
    });

    expect(result.current.frameRef.current).not.toBeNull();
  });

  it('reset() re-initialises to the ISCO', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    // Step a few times to move r inward
    act(() => { result.current.step(); result.current.step(); });
    const rAfterSteps = result.current.stateRef.current!.r;
    expect(rAfterSteps).toBeLessThan(6.0);

    // Reset
    act(() => { result.current.reset(); });

    expect(wasm_init).toHaveBeenCalledTimes(2); // once on init, once on reset
    expect(result.current.stateRef.current!.r).toBeCloseTo(6.0, 5);
    expect(result.current.frameRef.current).toBeNull();
  });

  it('reset() accepts param overrides', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());

    act(() => { result.current.reset({ spin: 0.9 }); });

    expect(wasm_init).toHaveBeenLastCalledWith(1.0, 0.9, NaN);
  });

  it('hudSnapshot is set after initialisation', async () => {
    const { result } = renderHook(() => useSim(mockApi, defaultParams));
    await waitFor(() => expect(result.current.hudSnapshot).not.toBeNull());

    expect(result.current.hudSnapshot!.r).toBeCloseTo(6.0, 5);
    expect(result.current.hudSnapshot!.properTime).toBe(0);
    expect(result.current.hudSnapshot!.insideHorizon).toBe(false);
    expect(result.current.hudSnapshot!.terminated).toBe(false);
  });

  it('reinitialises when params change', async () => {
    const { result, rerender } = renderHook(
      (p) => useSim(mockApi, p),
      { initialProps: defaultParams }
    );
    await waitFor(() => expect(result.current.stateRef.current).not.toBeNull());
    expect(wasm_init).toHaveBeenCalledTimes(1);

    rerender({ mass: 1.0, spin: 0.5 });
    await waitFor(() => expect(wasm_init).toHaveBeenCalledTimes(2));
    expect(wasm_init).toHaveBeenLastCalledWith(1.0, 0.5, NaN);
  });
});
