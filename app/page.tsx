'use client';

import { useRef, useState } from 'react';
import { useWasm } from '@/hooks/useWasm';
import { useSim } from '@/hooks/useSim';
import { DEFAULT_PARAMS } from '@/lib/wasm-types';
import SimCanvas from './components/SimCanvas';

export default function Home() {
  const { ready, api, error } = useWasm();
  const timeWarpRef    = useRef(1);
  const camDistanceRef = useRef(35);
  const [started, setStarted] = useState(false);
  const [fading,  setFading]  = useState(false);

  const sim = useSim(ready ? api : null, DEFAULT_PARAMS);

  function handleStart() {
    setFading(true);
    setTimeout(() => setStarted(true), 800);
  }

  return (
    <main className="relative w-full h-full">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
          <p className="text-red-500 text-sm">Failed to load physics engine: {error.message}</p>
        </div>
      )}

      <SimCanvas sim={sim} running={started} timeWarpRef={timeWarpRef} camDistanceRef={camDistanceRef} />

      {!started && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black"
          style={{ opacity: fading ? 0 : 1, transition: 'opacity 0.8s ease' }}
        >
          <div className="flex flex-col items-center gap-8 text-center">
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-6xl tracking-widest text-white uppercase">Infall</h1>
              <p className="text-sm tracking-[0.3em] text-neutral-500 uppercase">Kerr black hole · geodesic simulation</p>
            </div>

            <div className="w-px h-12 bg-neutral-700" />

            <button
              onClick={handleStart}
              disabled={!ready}
              className="text-sm tracking-[0.25em] uppercase text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-400 px-8 py-3 transition-colors duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {ready ? 'Begin' : 'Loading…'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
