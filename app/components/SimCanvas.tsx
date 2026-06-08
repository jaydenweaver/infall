'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SimControls } from '@/hooks/useSim';
import type { BlackHoleParams } from '@/lib/wasm-types';
import {
  blToCartesian,
  cameraUp,
  randomStarPositions,
  WORLD_SCALE,
  STAR_SPHERE_RADIUS,
} from '@/lib/coordinates';

const STAR_COUNT = 8_000;

/** Accretion disk inner/outer radii relative to ISCO (in M). */
const DISK_INNER_FACTOR = 1.0; // starts at ISCO
const DISK_OUTER_M = 20.0;    // outer edge in M

interface Props {
  sim: SimControls;
  running: boolean;
  timeWarpRef: React.MutableRefObject<number>;
}

export default function SimCanvas({ sim, running, timeWarpRef }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 1);
    mount.appendChild(renderer.domElement);

    // ── Scene & Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      90,
      mount.clientWidth / mount.clientHeight,
      0.1,
      STAR_SPHERE_RADIUS * 2
    );
    // Start camera at initial observer position (r ≈ ISCO ≈ 6M, equatorial)
    camera.position.set(0, 0, 6 * WORLD_SCALE);
    camera.lookAt(0, 0, 0);

    // ── Black hole (event horizon sphere) ────────────────────────────────────
    // Schwarzschild radius for mass=1 is 2M; for Kerr it varies but 2M is a
    // reasonable stand-in — the WASM returns the exact value via wasm_event_horizon.
    // We'll start with 2M and leave exact sizing for Phase 3 (shader-based).
    const bhRadius = 2.0 * WORLD_SCALE;
    const bhGeom = new THREE.SphereGeometry(bhRadius, 64, 32);
    const bhMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const bhMesh = new THREE.Mesh(bhGeom, bhMat);
    scene.add(bhMesh);

    // Subtle glow ring just outside the photon sphere (≈ 3M for Schwarzschild)
    const glowRadius = 3.0 * WORLD_SCALE;
    const glowGeom = new THREE.RingGeometry(glowRadius * 0.98, glowRadius * 1.08, 128);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.15,
    });
    const glowMesh = new THREE.Mesh(glowGeom, glowMat);
    glowMesh.rotation.x = Math.PI / 2;
    scene.add(glowMesh);

    // ── Accretion disk ────────────────────────────────────────────────────────
    // Flat ring in the equatorial plane. Phase 3 will replace this with a
    // GPU fragment shader computing null geodesic lensing.
    const diskInner = 6.0 * WORLD_SCALE * DISK_INNER_FACTOR;
    const diskOuter = DISK_OUTER_M * WORLD_SCALE;
    const diskGeom = new THREE.RingGeometry(diskInner, diskOuter, 256, 4);

    // Vertex-colour gradient: hot (white/blue) near ISCO, cooler (orange/red) farther
    const diskPositions = diskGeom.attributes.position;
    const colors = new Float32Array(diskPositions.count * 3);
    for (let i = 0; i < diskPositions.count; i++) {
      const x = diskPositions.getX(i);
      const z = diskPositions.getZ(i);
      const r = Math.sqrt(x * x + z * z);
      const t = Math.max(0, Math.min(1, (r - diskInner) / (diskOuter - diskInner)));
      // Hot inner region: white → orange → deep red
      colors[i * 3]     = 1.0;                           // R
      colors[i * 3 + 1] = 0.6 * (1 - t) + 0.15 * t;    // G
      colors[i * 3 + 2] = 0.4 * (1 - t);                // B
    }
    diskGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const diskMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const diskMesh = new THREE.Mesh(diskGeom, diskMat);
    diskMesh.rotation.x = Math.PI / 2; // lie in XZ plane (equatorial)
    scene.add(diskMesh);

    // ── Star field ────────────────────────────────────────────────────────────
    const starPositions = randomStarPositions(STAR_COUNT, STAR_SPHERE_RADIUS);
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2500, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeom, starMat));

    // ── Resize handler ────────────────────────────────────────────────────────
    function onResize() {
      const w = mount!.clientWidth;
      const h = mount!.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // ── Animation loop ────────────────────────────────────────────────────────
    let rafId: number;

    function animate() {
      rafId = requestAnimationFrame(animate);

      if (runningRef.current) {
        // Sync time_warp from the control ref into sim state
        if (sim.stateRef.current) {
          sim.stateRef.current.time_warp = timeWarpRef.current;
        }

        const frame = sim.step();
        if (frame) {
          const [cx, cy, cz] = blToCartesian(frame.r, frame.theta, frame.phi);
          camera.position.set(cx, cy, cz);

          const [ux, uy, uz] = cameraUp(frame.theta, frame.phi);
          camera.up.set(ux, uy, uz);

          // Always look toward the singularity (center of the scene)
          camera.lookAt(0, 0, 0);

          // Inside-horizon vignette: darken renderer background
          if (frame.inside_horizon) {
            const depth = Math.max(0, 1 - frame.r / 2.0);
            const darkness = Math.floor(depth * 255);
            renderer.setClearColor(
              new THREE.Color(darkness / 255 * 0.02, 0, darkness / 255 * 0.02),
              1
            );
          } else {
            renderer.setClearColor(0x000000, 1);
          }
        }
      }

      renderer.render(scene, camera);
    }

    animate();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [sim, timeWarpRef]); // sim reference is stable; effect runs once

  return <div ref={mountRef} className="absolute inset-0" />;
}
