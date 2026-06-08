import { renderHook, waitFor } from '@testing-library/react';
import { useWasm } from '../useWasm';

describe('useWasm', () => {
  it('starts in loading state', () => {
    const { result } = renderHook(() => useWasm());
    expect(result.current.ready).toBe(false);
    expect(result.current.api).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions to ready after WASM loads', async () => {
    const { result } = renderHook(() => useWasm());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.api).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('exposes the expected API methods when ready', async () => {
    const { result } = renderHook(() => useWasm());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const api = result.current.api!;
    expect(typeof api.wasm_init).toBe('function');
    expect(typeof api.wasm_step).toBe('function');
    expect(typeof api.wasm_event_horizon).toBe('function');
    expect(typeof api.wasm_isco_radius).toBe('function');
    expect(typeof api.wasm_ergosphere_radius).toBe('function');
  });

  it('does not become ready a second time (stable reference)', async () => {
    const { result, rerender } = renderHook(() => useWasm());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const api1 = result.current.api;

    rerender();
    // Re-render should not reset state
    expect(result.current.ready).toBe(true);
    expect(result.current.api).toBe(api1);
  });
});
