'use client';

import { useState } from 'react';
import type { BlackHoleParams } from '@/lib/wasm-types';

interface Props {
  params: BlackHoleParams;
  running: boolean;
  onParamsChange: (p: BlackHoleParams) => void;
  onRunningChange: (r: boolean) => void;
  onReset: () => void;
  onTimeWarp: (v: number) => void;
}

export default function Controls({
  params,
  running,
  onParamsChange,
  onRunningChange,
  onReset,
  onTimeWarp,
}: Props) {
  const [timeWarp, setTimeWarp] = useState(1);

  function handleTimeWarp(v: number) {
    setTimeWarp(v);
    onTimeWarp(v);
  }

  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-3 w-52 text-xs text-gray-300">
      {/* Camera distance */}
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">
          Distance <span className="text-white font-bold">{params.initialR.toFixed(0)} M</span>
        </span>
        <input
          type="range"
          min={6}
          max={50}
          step={1}
          value={params.initialR}
          onChange={(e) => onParamsChange({ ...params, initialR: Number(e.target.value) })}
          className="accent-orange-500"
        />
      </label>

      {/* Spin */}
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">
          Spin (a/M) <span className="text-white font-bold">{params.spin.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={0.99}
          step={0.01}
          value={params.spin}
          onChange={(e) => onParamsChange({ ...params, spin: Number(e.target.value) })}
          className="accent-orange-500"
        />
      </label>

      {/* Mass */}
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">
          Mass (M) <span className="text-white font-bold">{params.mass.toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.1}
          value={params.mass}
          onChange={(e) => onParamsChange({ ...params, mass: Number(e.target.value) })}
          className="accent-orange-500"
        />
      </label>

      {/* Time warp */}
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">
          Time warp <span className="text-white font-bold">{timeWarp}×</span>
        </span>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={timeWarp}
          onChange={(e) => handleTimeWarp(Number(e.target.value))}
          className="accent-orange-500"
        />
      </label>

      {/* Buttons */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => onRunningChange(!running)}
          className="flex-1 py-1.5 rounded border border-gray-600 hover:border-gray-400 transition-colors"
        >
          {running ? 'Pause' : 'Resume'}
        </button>
        <button
          onClick={onReset}
          className="flex-1 py-1.5 rounded border border-gray-600 hover:border-gray-400 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
