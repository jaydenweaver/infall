'use client';

import { useState, useEffect } from 'react';

const controls = [
  { key: 'Drag',   desc: 'Orbit camera' },
  { key: 'Scroll', desc: 'Zoom' },
  { key: 'Space',  desc: 'Toggle free-look' },
];

interface Props {
  fpsRef:   React.MutableRefObject<number>;
  stepsRef: React.MutableRefObject<number>;
}

export default function HelpIcon({ fpsRef, stepsRef }: Props) {
  const [open,  setOpen]  = useState(false);
  const [fps,   setFps]   = useState(0);
  const [steps, setSteps] = useState(600);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setFps(fpsRef.current);
      setSteps(stepsRef.current);
    }, 500);
    return () => clearInterval(id);
  }, [open, fpsRef, stepsRef]);

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-500 hover:text-white hover:border-neutral-400 transition-colors text-sm"
      >
        ?
      </button>

      {open && (
        <div className="border border-neutral-800 bg-black/80 px-5 py-4 flex flex-col gap-3">
          {controls.map(({ key, desc }) => (
            <div key={key} className="flex items-baseline gap-4 text-sm">
              <span className="text-neutral-500 w-14 text-right shrink-0">{key}</span>
              <span className="text-neutral-300">{desc}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4 text-sm">
            <span className="text-neutral-500 w-14 text-right shrink-0">FPS</span>
            <span className="text-neutral-300">{fps}</span>
          </div>
          <div className="flex items-baseline gap-4 text-sm">
            <span className="text-neutral-500 w-14 text-right shrink-0">Steps</span>
            <span className="text-neutral-300">{steps}</span>
          </div>
          <a href="https://jaydenw.dev" target="_blank" rel="noopener noreferrer" className="text-white-400 hover:text-gray-300 transition-colors">
            jaydenw.dev
          </a>
          <a href="https://github.com/jaydenweaver/infall" target="_blank" rel="noopener noreferrer" className="text-white-400 hover:text-gray-300 transition-colors">
            github source
          </a>
        </div>
      )}
    </div>
  );
}
