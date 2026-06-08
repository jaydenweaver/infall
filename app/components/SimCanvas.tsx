'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { SimControls } from '@/hooks/useSim';
import {
  blToCartesian,
  cameraUp,
  randomStarPositions,
  WORLD_SCALE,
  STAR_SPHERE_RADIUS,
} from '@/lib/coordinates';
import {
  LENS_VERT,
  LENS_FRAG,
  createLensingUniforms,
  updateLensingUniforms,
  type LensingUniforms,
} from '@/shaders/lensing';

const STAR_COUNT    = 8_000;
const DISK_INNER_M  = 2.1;
const DISK_OUTER_M  = 25.0;

interface Props {
  sim: SimControls;
  running: boolean;
  timeWarpRef: React.MutableRefObject<number>;
}

export default function SimCanvas({ sim, running, timeWarpRef }: Props) {
  const mountRef   = useRef<HTMLDivElement>(null);
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

    // ── Black hole shadow sphere ───────────────────────────────────────────────
    // The lensing pass already traces geodesics and produces the correct photon
    // shadow.  This opaque sphere ensures the shadow area is black even if the
    // lensing pass is slow to converge on deeply-lensed pixels.
    const bhMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.0 * WORLD_SCALE, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    scene.add(bhMesh);

    // ── Post-processing: lensing pass ─────────────────────────────────────────
    // RenderPass → writes stars + BH sphere to tDiffuse.
    // LensingPass → traces null geodesics per pixel, warps the background,
    //               and composites primary + secondary disk images.
    //
    // IMPORTANT: ShaderPass clones the uniforms object internally via
    // THREE.UniformsUtils.clone().  All per-frame updates must target
    // lensingPass.uniforms (the clone), not the object passed to the constructor.
    const initialR = camera.position.length() / WORLD_SCALE; // 8 M
    // Camera starts at (0, 0, 8·WS) = BL φ = π/2 (z-axis), so cam_phi = π/2.
    const initialFwd: [number, number, number] = [0, 0, -1];  // looking at origin
    const initialRight: [number, number, number] = [1, 0, 0];
    const initialUp: [number, number, number]   = [0, 1, 0];

    const lensingPass = new ShaderPass({
      uniforms: createLensingUniforms(
        {
          mass:        1.0,
          cam_r:       initialR,
          cam_theta:   Math.PI / 2,
          cam_phi:     Math.PI / 2,  // camera is on the +Z axis → φ = π/2
          cam_right:   initialRight,
          cam_up_vec:  initialUp,
          cam_forward: initialFwd,
          resolution:  [mount.clientWidth, mount.clientHeight],
        },
        DISK_INNER_M,
        DISK_OUTER_M,
        2.0, // Schwarzschild horizon = 2M for mass=1
      ),
      vertexShader:   LENS_VERT,
      fragmentShader: LENS_FRAG,
    });

    // lensingPass.uniforms is the clone Three.js made — this is what the GPU reads.
    const lensUniforms = lensingPass.uniforms as LensingUniforms;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(lensingPass);

    // ── Resize handler ────────────────────────────────────────────────────────
    function onResize() {
      camera.aspect = mount!.clientWidth / mount!.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount!.clientWidth, mount!.clientHeight);
      composer.setSize(mount!.clientWidth, mount!.clientHeight);
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
          // Camera follows the observer's geodesic
          const [cx, cy, cz] = blToCartesian(frame.r, frame.theta, frame.phi);
          camera.position.set(cx, cy, cz);
          const [ux, uy, uz] = cameraUp(frame.theta, frame.phi);
          camera.up.set(ux, uy, uz);
          camera.lookAt(0, 0, 0);
          camera.updateMatrixWorld();

          // Derive camera basis vectors from the updated camera transform
          const camFwd = camera.position.clone().negate().normalize();
          const camRight = new THREE.Vector3()
            .crossVectors(camFwd, camera.up)
            .normalize();

          // Update the cloned uniforms that the ShaderPass actually reads
          updateLensingUniforms(lensUniforms, {
            mass:        sim.stateRef.current.mass,
            cam_r:       frame.r,
            cam_theta:   frame.theta,
            cam_phi:     frame.phi,
            cam_right:   [camRight.x, camRight.y, camRight.z],
            cam_up_vec:  [camera.up.x, camera.up.y, camera.up.z],
            cam_forward: [camFwd.x, camFwd.y, camFwd.z],
            resolution:  [mount!.clientWidth, mount!.clientHeight],
          });

          // Deepen to black as observer descends past the horizon
          if (frame.inside_horizon) {
            const depth = Math.max(0, Math.min(1, 1 - frame.r / 2));
            renderer.setClearColor(new THREE.Color(depth * 0.02, 0, depth * 0.03), 1);
          } else {
            renderer.setClearColor(0x000000, 1);
          }
        }
      }

      composer.render();
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [sim, timeWarpRef]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
