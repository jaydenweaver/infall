'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SimControls } from '@/hooks/useSim';
import {
  blToCartesian,
  cameraUp,
  randomStarPositions,
  WORLD_SCALE,
  STAR_SPHERE_RADIUS,
} from '@/lib/coordinates';
import { createDiskMaterial, updateDiskUniforms } from '@/shaders/disk';

const STAR_COUNT = 8_000;

const DISK_INNER_M = 2.1;
const DISK_OUTER_M = 25.0;

/** Vertical layer offsets (in M) give apparent disk thickness when viewed edge-on. */
const DISK_LAYER_Y_M = [0.0, 0.6, -0.6];

interface Props {
  sim: SimControls;
  running: boolean;
  timeWarpRef: React.MutableRefObject<number>;
}

export default function SimCanvas({ sim, running, timeWarpRef }: Props) {
  const mountRef  = useRef<HTMLDivElement>(null);
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
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      90,
      mount.clientWidth / mount.clientHeight,
      0.1,
      STAR_SPHERE_RADIUS * 2,
    );
    camera.position.set(0, 0, 8 * WORLD_SCALE);
    camera.lookAt(0, 0, 0);

    // ── Stars (renderOrder 0) ─────────────────────────────────────────────────
    const starPos = randomStarPositions(STAR_COUNT, STAR_SPHERE_RADIUS);
    const starCol = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const roll = Math.random();
      if (roll < 0.15) {
        starCol[i*3]=0.75; starCol[i*3+1]=0.88; starCol[i*3+2]=1.0;  // blue-white
      } else if (roll < 0.30) {
        starCol[i*3]=1.0;  starCol[i*3+1]=0.80; starCol[i*3+2]=0.55; // warm orange
      } else {
        starCol[i*3]=1.0;  starCol[i*3+1]=1.0;  starCol[i*3+2]=1.0;  // white
      }
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color',    new THREE.BufferAttribute(starCol, 3));
    scene.add(new THREE.Points(
      starGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 2500, sizeAttenuation: true }),
    ));

    // ── Accretion disk (renderOrder 1) ────────────────────────────────────────
    // Single ShaderMaterial shared across all layers — uniform updates apply to all.
    const diskMat = createDiskMaterial(
      { mass: 1.0, spin: 0.0, obs_r: 6.0, obs_phi: 0.0 },
      DISK_INNER_M,
      DISK_OUTER_M,
      WORLD_SCALE,
    );

    const diskGeom = new THREE.RingGeometry(
      DISK_INNER_M * WORLD_SCALE,
      DISK_OUTER_M * WORLD_SCALE,
      256, 8,
    );

    for (const yM of DISK_LAYER_Y_M) {
      const mesh = new THREE.Mesh(diskGeom, diskMat);
      mesh.rotation.x  = Math.PI / 2;
      mesh.position.y  = yM * WORLD_SCALE;
      mesh.renderOrder = 1;
      scene.add(mesh);
    }

    // ── Black hole shadow sphere (renderOrder 2) ───────────────────────────────
    // Rendered last so it always paints over disk pixels inside the shadow radius.
    const bhMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.0 * WORLD_SCALE, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    bhMesh.renderOrder = 2;
    scene.add(bhMesh);

    // ── Resize handler ────────────────────────────────────────────────────────
    function onResize() {
      camera.aspect = mount!.clientWidth / mount!.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount!.clientWidth, mount!.clientHeight);
    }
    window.addEventListener('resize', onResize);

    // ── Animation loop ────────────────────────────────────────────────────────
    let rafId: number;

    function animate() {
      rafId = requestAnimationFrame(animate);

      if (runningRef.current) {
        if (sim.stateRef.current) {
          sim.stateRef.current.time_warp = timeWarpRef.current;
        }

        const frame = sim.step();
        if (frame && sim.stateRef.current) {
          // Update disk Doppler / temperature uniforms
          updateDiskUniforms(diskMat, {
            mass:    sim.stateRef.current.mass,
            spin:    sim.stateRef.current.spin,
            obs_r:   frame.r,
            obs_phi: frame.phi,
          });

          // Camera follows the observer's geodesic
          const [cx, cy, cz] = blToCartesian(frame.r, frame.theta, frame.phi);
          camera.position.set(cx, cy, cz);
          const [ux, uy, uz] = cameraUp(frame.theta, frame.phi);
          camera.up.set(ux, uy, uz);
          camera.lookAt(0, 0, 0);

          // Deepen to black as observer descends past the horizon
          if (frame.inside_horizon) {
            const depth = Math.max(0, Math.min(1, 1 - frame.r / 2));
            renderer.setClearColor(new THREE.Color(depth * 0.02, 0, depth * 0.03), 1);
          } else {
            renderer.setClearColor(0x000000, 1);
          }
        }
      }

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [sim, timeWarpRef]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
