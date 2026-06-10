'use client';

import { useRef } from 'react';
import { useWasm } from '@/hooks/useWasm';
import { useSim } from '@/hooks/useSim';
import { DEFAULT_PARAMS } from '@/lib/wasm-types';
import SimCanvas from './components/SimCanvas';
import HelpIcon from './components/HelpIcon';

export default function Home() {
  const { ready, api, error } = useWasm();
  const timeWarpRef    = useRef(1);
  const camDistanceRef = useRef(35);

  const sim = useSim(ready ? api : null, DEFAULT_PARAMS);

  return (
    <main className="relative w-full h-full">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-50">
          <p className="text-red-500 text-sm">Failed to load physics engine: {error.message}</p>
        </div>
      )}

      <SimCanvas sim={sim} running={true} timeWarpRef={timeWarpRef} camDistanceRef={camDistanceRef} />

      <HelpIcon />
    </main>
  );
}
