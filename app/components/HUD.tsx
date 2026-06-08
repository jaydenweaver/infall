'use client';

import type { HudSnapshot } from '@/hooks/useSim';
import type { BlackHoleParams } from '@/lib/wasm-types';

interface Props {
  snapshot: HudSnapshot | null;
  ready: boolean;
  params: BlackHoleParams;
}

export default function HUD({ snapshot, ready, params }: Props) {
  if (!ready) {
    return (
      <div className="absolute top-4 left-4 text-xs text-gray-500 pointer-events-none">
        LOADING PHYSICS ENGINE…
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 pointer-events-none select-none">
      <div className="text-xs leading-5 text-green-400 opacity-80 space-y-0.5">
        <Row label="M" value={params.mass.toFixed(2)} />
        <Row label="a/M" value={params.spin.toFixed(2)} />
        <div className="border-t border-green-900 my-1" />
        <Row label="r" value={snapshot ? `${snapshot.r.toFixed(3)} M` : '—'} />
        <Row label="τ" value={snapshot ? `${snapshot.properTime.toFixed(4)} M` : '—'} />
        <div className="border-t border-green-900 my-1" />
        {snapshot?.insideHorizon && (
          <div className="text-red-400 animate-pulse">INSIDE HORIZON</div>
        )}
        {snapshot?.terminated && (
          <div className="text-yellow-300">SINGULARITY REACHED</div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 text-green-600">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
