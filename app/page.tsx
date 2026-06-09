'use client';

import { useState, useRef } from 'react';
import { useWasm } from '@/hooks/useWasm';
import { useSim } from '@/hooks/useSim';
import { DEFAULT_PARAMS } from '@/lib/wasm-types';
import type { BlackHoleParams } from '@/lib/wasm-types';
import SimCanvas from './components/SimCanvas';
import HUD from './components/HUD';
import Controls from './components/Controls';

export default function Home() {
  const { ready, api, error } = useWasm();
  const [params, setParams] = useState<BlackHoleParams>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(true);
  const timeWarpRef    = useRef(1);
  const camDistanceRef = useRef(8);
  const [camDistance, setCamDistance] = useState(8);

  function handleCamDistance(v: number) {
    camDistanceRef.current = v;
    setCamDistance(v);
  }

  const sim = useSim(ready ? api : null, params);

  function handleParamsChange(next: BlackHoleParams) {
    setParams(next);
    // useSim re-initialises automatically when params change
  }

  function handleReset() {
    sim.reset();
  }

  function handleTimeWarp(value: number) {
    timeWarpRef.current = value;
    if (sim.stateRef.current) {
      sim.stateRef.current.time_warp = value;
    }
  }

  return (
    <main className="relative w-full h-full">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
          <p className="text-red-500 text-sm">Failed to load physics engine: {error.message}</p>
        </div>
      )}

      <SimCanvas sim={sim} running={running} timeWarpRef={timeWarpRef} camDistanceRef={camDistanceRef} />

      <HUD
        snapshot={sim.hudSnapshot}
        ready={ready}
        params={params}
      />

      <Controls
        params={params}
        running={running}
        camDistance={camDistance}
        onParamsChange={handleParamsChange}
        onRunningChange={setRunning}
        onReset={handleReset}
        onTimeWarp={handleTimeWarp}
        onCamDistanceChange={handleCamDistance}
      />
    </main>
  );
}
