'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { SimControls } from '@/hooks/useSim';
import {
  blToCartesian,
  cameraUp,
} from '@/lib/coordinates';
import {
  LENS_VERT,
  LENS_FRAG,
  createLensingUniforms,
  updateLensingUniforms,
  type LensingUniforms,
} from '@/shaders/lensing';

const DISK_INNER_M        = 6.0;
const DISK_OUTER_M        = 22.0;
const CAM_THETA_ELEVATION = 0.2;

interface Props {
  sim: SimControls;
  running: boolean;
  timeWarpRef: React.MutableRefObject<number>;
  camDistanceRef: React.MutableRefObject<number>;
}

export default function SimCanvas({ sim, running, timeWarpRef, camDistanceRef }: Props) {
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

    // ── Scene / camera (scene is empty — lensing shader draws everything) ────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      90,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1e6,
    );
    const initialTheta = Math.PI / 2 - CAM_THETA_ELEVATION;
    const initialPhi   = Math.PI / 2;
    const [icx, icy, icz] = blToCartesian(8, initialTheta, initialPhi);
    camera.position.set(icx, icy, icz);
    const [iux, iuy, iuz] = cameraUp(initialTheta, initialPhi);
    camera.up.set(iux, iuy, iuz);
    camera.lookAt(0, 0, 0);

    // ── Lensing ShaderPass ────────────────────────────────────────────────────
    // Derives initial camera basis from the camera we positioned above.
    camera.updateMatrixWorld();
    const initFwd   = camera.position.clone().negate().normalize();
    const initUp    = camera.up.clone().normalize();
    const initRight = new THREE.Vector3().crossVectors(initFwd, initUp).normalize();

    const lensingPass = new ShaderPass({
      uniforms: createLensingUniforms(
        {
          mass:        1.0,
          spin:        0.0,
          cam_r:       8.0,
          cam_theta:   initialTheta,
          cam_phi:     initialPhi,
          cam_right:   [initRight.x, initRight.y, initRight.z],
          cam_up_vec:  [initUp.x,    initUp.y,    initUp.z],
          cam_forward: [initFwd.x,   initFwd.y,   initFwd.z],
          resolution:  [mount.clientWidth, mount.clientHeight],
        },
        DISK_INNER_M,
        DISK_OUTER_M,
        2.0,
      ),
      vertexShader:   LENS_VERT,
      fragmentShader: LENS_FRAG,
    });

    // Render directly to screen — no CopyPass needed.
    lensingPass.renderToScreen = true;
    const lensUniforms = lensingPass.uniforms as LensingUniforms;

    const composer = new EffectComposer(renderer);
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
    let latestTheta = initialTheta;
    let latestPhi   = initialPhi;
    let latestMass  = 1.0;
    let latestSpin  = 0.0;
    let frameCount  = 0;

    function animate() {
      rafId = requestAnimationFrame(animate);

      // Advance simulation
      if (runningRef.current) {
        if (sim.stateRef.current) {
          sim.stateRef.current.time_warp = timeWarpRef.current;
        }
        const frame = sim.step();
        if (frame && sim.stateRef.current) {
          latestTheta = frame.theta;
          latestPhi   = frame.phi;
          latestMass  = sim.stateRef.current.mass;
          latestSpin  = sim.stateRef.current.spin;

          if (frame.inside_horizon) {
            const depth = Math.max(0, Math.min(1, 1 - frame.r / 2));
            renderer.setClearColor(new THREE.Color(depth * 0.02, 0, depth * 0.03), 1);
          } else {
            renderer.setClearColor(0x000000, 1);
          }
        }
      }

      // Update camera (responds to distance slider live)
      const r           = camDistanceRef.current;
      const renderTheta = latestTheta - CAM_THETA_ELEVATION;
      const [cx, cy, cz] = blToCartesian(r, renderTheta, latestPhi);
      camera.position.set(cx, cy, cz);
      const [ux, uy, uz] = cameraUp(renderTheta, latestPhi);
      camera.up.set(ux, uy, uz);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const camFwd   = camera.position.clone().negate().normalize();
      const camRight = new THREE.Vector3()
        .crossVectors(camFwd, camera.up)
        .normalize();

      updateLensingUniforms(lensUniforms, {
        mass:        latestMass,
        spin:        latestSpin,
        cam_r:       r,
        cam_theta:   renderTheta,
        cam_phi:     latestPhi,
        cam_right:   [camRight.x, camRight.y, camRight.z],
        cam_up_vec:  [camera.up.x, camera.up.y, camera.up.z],
        cam_forward: [camFwd.x, camFwd.y, camFwd.z],
        resolution:  [mount!.clientWidth, mount!.clientHeight],
      });
      lensUniforms.u_frame.value = frameCount++;

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
