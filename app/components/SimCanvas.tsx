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

const STAR_COUNT = 8_000;

// Disk inner edge just outside the event horizon; outer edge far enough to be cinematic
const DISK_INNER_M = 1.5;
const DISK_OUTER_M = 30.0;

/**
 * Stacked vertical layers give the disk apparent thickness when viewed edge-on
 * from the equatorial plane. Additive blending sums their brightness.
 */
const DISK_LAYERS: Array<{ yM: number; opacity: number }> = [
  { yM:  0.0, opacity: 0.70 },
  { yM:  0.4, opacity: 0.40 },
  { yM: -0.4, opacity: 0.40 },
  { yM:  1.2, opacity: 0.18 },
  { yM: -1.2, opacity: 0.18 },
  { yM:  3.0, opacity: 0.06 },
  { yM: -3.0, opacity: 0.06 },
];

interface Props {
  sim: SimControls;
  running: boolean;
  timeWarpRef: React.MutableRefObject<number>;
}

/** Ring geometry with a hot-inner / cool-outer vertex-colour gradient. */
function makeDiskRing(innerW: number, outerW: number): THREE.BufferGeometry {
  const geom = new THREE.RingGeometry(innerW, outerW, 256, 8);
  const pos = geom.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, (Math.sqrt(x * x + z * z) - innerW) / (outerW - innerW)));
    col[i * 3]     = t < 0.12 ? 1.0 : 1.0 - t * 0.18;                      // R
    col[i * 3 + 1] = t < 0.12 ? 0.88 : Math.max(0.04, 0.75 * (1 - t));     // G
    col[i * 3 + 2] = Math.max(0, t < 0.12 ? 0.65 : 0.45 * (1 - t * 2.5)); // B
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom;
}

/** Transparent additive sphere for glow/corona effects. */
function addGlowSphere(scene: THREE.Scene, radiusM: number, color: number, opacity: number) {
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(radiusM * WORLD_SCALE, 48, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide, // glow radiates outward from the interior surface
    })
  ));
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
    camera.position.set(0, 2 * WORLD_SCALE, 8 * WORLD_SCALE);
    camera.lookAt(0, 0, 0);

    // ── Black hole shadow (event horizon) ─────────────────────────────────────
    // Rendered on top (renderOrder 10) so additive glow layers behind don't bleed through
    const bhMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.0 * WORLD_SCALE, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    bhMesh.renderOrder = 10;
    scene.add(bhMesh);

    // ── Corona and photon-sphere atmospheric glow ─────────────────────────────
    addGlowSphere(scene, 2.5, 0xff7700, 0.28); // inner corona (hot orange)
    addGlowSphere(scene, 3.2, 0xff4400, 0.13); // photon sphere shell
    addGlowSphere(scene, 5.0, 0xff2200, 0.04); // outer diffuse halo

    // ── Accretion disk — layered for edge-on visibility ───────────────────────
    const diskGeom = makeDiskRing(DISK_INNER_M * WORLD_SCALE, DISK_OUTER_M * WORLD_SCALE);
    for (const { yM, opacity } of DISK_LAYERS) {
      const mesh = new THREE.Mesh(
        diskGeom,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = yM * WORLD_SCALE;
      scene.add(mesh);
    }

    // ── Star field ────────────────────────────────────────────────────────────
    const starPos = randomStarPositions(STAR_COUNT, STAR_SPHERE_RADIUS);
    const starCol = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const roll = Math.random();
      if (roll < 0.15) {         // hot blue-white
        starCol[i*3]=0.75; starCol[i*3+1]=0.88; starCol[i*3+2]=1.0;
      } else if (roll < 0.30) {  // warm orange
        starCol[i*3]=1.0;  starCol[i*3+1]=0.80; starCol[i*3+2]=0.55;
      } else {                   // pure white
        starCol[i*3]=1.0;  starCol[i*3+1]=1.0;  starCol[i*3+2]=1.0;
      }
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    scene.add(new THREE.Points(
      starGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 2500, sizeAttenuation: true })
    ));

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
        if (frame) {
          const [cx, cy, cz] = blToCartesian(frame.r, frame.theta, frame.phi);
          camera.position.set(cx, cy, cz);
          const [ux, uy, uz] = cameraUp(frame.theta, frame.phi);
          camera.up.set(ux, uy, uz);
          camera.lookAt(0, 0, 0);

          // Deep red darkness creeps in as the observer crosses and descends below the horizon
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
