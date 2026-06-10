'use client';

import { useEffect, useRef, useState } from 'react';
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
const MOUSE_SENSITIVITY   = 0.0015;

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
  const simRef = useRef(sim);
  simRef.current = sim;

  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 1);
    mount.appendChild(renderer.domElement);

    // ── Scene / camera ────────────────────────────────────────────────────────
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

    // ── Lensing ShaderPass ────────────────────────────────────────────────────
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

    lensingPass.renderToScreen = true;
    const lensUniforms = lensingPass.uniforms as LensingUniforms;

    const composer = new EffectComposer(renderer);
    composer.addPass(lensingPass);

    // ── Mouse look (pointer lock) ─────────────────────────────────────────────
    let yawTarget   = 0;
    let pitchTarget = 0;
    let yaw         = 0;
    let pitch       = 0;
    const SMOOTH    = 0.05;   // lerp factor per frame (lower = smoother)
    const canvas = renderer.domElement;

    function onMouseMove(e: MouseEvent) {
      if (document.pointerLockElement !== canvas) return;
      yawTarget   -= e.movementX * MOUSE_SENSITIVITY;
      pitchTarget -= e.movementY * MOUSE_SENSITIVITY;
      pitchTarget  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitchTarget));
    }

    function onPointerLockChange() {
      setLocked(document.pointerLockElement === canvas);
    }

    function requestLock() {
      if (document.pointerLockElement !== canvas) {
        // requestPointerLock returns a Promise in modern browsers
        const result = canvas.requestPointerLock();
        if (result instanceof Promise) {
          result.catch(() => {/* denied — ignore */});
        }
      }
    }

    // Listen on both canvas and mount so the full div area is clickable
    canvas.addEventListener('click', requestLock);
    mount.addEventListener('click', requestLock);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);

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
        if (simRef.current.stateRef.current) {
          simRef.current.stateRef.current.time_warp = timeWarpRef.current;
        }
        const frame = simRef.current.step();
        if (frame && simRef.current.stateRef.current) {
          latestTheta = frame.theta;
          latestPhi   = frame.phi;
          latestMass  = simRef.current.stateRef.current.mass;
          latestSpin  = simRef.current.stateRef.current.spin;

          if (frame.inside_horizon) {
            const depth = Math.max(0, Math.min(1, 1 - frame.r / 2));
            renderer.setClearColor(new THREE.Color(depth * 0.02, 0, depth * 0.03), 1);
          } else {
            renderer.setClearColor(0x000000, 1);
          }
        }
      }

      // Camera position
      const r           = camDistanceRef.current;
      const renderTheta = latestTheta - CAM_THETA_ELEVATION;
      const [cx, cy, cz] = blToCartesian(r, renderTheta, latestPhi);
      camera.position.set(cx, cy, cz);
      const [ux, uy, uz] = cameraUp(renderTheta, latestPhi);

      // Smooth mouse look
      yaw   += (yawTarget   - yaw)   * SMOOTH;
      pitch += (pitchTarget - pitch) * SMOOTH;

      // Natural basis (looking toward BH)
      const naturalFwd   = camera.position.clone().negate().normalize();
      const naturalUp    = new THREE.Vector3(ux, uy, uz);
      const naturalRight = new THREE.Vector3().crossVectors(naturalFwd, naturalUp).normalize();

      // Apply FPS yaw/pitch via quaternions
      const qYaw     = new THREE.Quaternion().setFromAxisAngle(naturalUp, yaw);
      const rotRight = naturalRight.clone().applyQuaternion(qYaw);
      const qPitch   = new THREE.Quaternion().setFromAxisAngle(rotRight, pitch);
      const q        = new THREE.Quaternion().multiplyQuaternions(qPitch, qYaw);

      const camFwd   = naturalFwd.clone().applyQuaternion(q);
      const camUp    = naturalUp.clone().applyQuaternion(q);
      const camRight = naturalRight.clone().applyQuaternion(q);

      updateLensingUniforms(lensUniforms, {
        mass:        latestMass,
        spin:        latestSpin,
        cam_r:       r,
        cam_theta:   renderTheta,
        cam_phi:     latestPhi,
        cam_right:   [camRight.x, camRight.y, camRight.z],
        cam_up_vec:  [camUp.x,    camUp.y,    camUp.z],
        cam_forward: [camFwd.x,   camFwd.y,   camFwd.z],
        resolution:  [mount!.clientWidth, mount!.clientHeight],
      });
      lensUniforms.u_frame.value = frameCount++;

      composer.render();
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', requestLock);
      mount.removeEventListener('click', requestLock);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="absolute inset-0 cursor-crosshair">
      {!locked && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-6">
          <span className="rounded border border-white/20 bg-black/60 px-4 py-1.5 text-sm text-white/70">
            Click to look around &nbsp;·&nbsp; ESC to release
          </span>
        </div>
      )}
    </div>
  );
}
