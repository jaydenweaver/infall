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

const DISK_INNER_M        = 5.0;
const DISK_OUTER_M        = 22.0;
const CAM_THETA_ELEVATION = -0.45;
const DRAG_SENSITIVITY    = 0.005;
const SCROLL_SENSITIVITY  = 0.05;

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
    const [icx, icy, icz] = blToCartesian(35, initialTheta, initialPhi);
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
          cam_r:       35.0,
          cam_theta:   initialTheta,
          cam_phi:     initialPhi,
          cam_right:   [initRight.x, initRight.y, initRight.z],
          cam_up_vec:  [initUp.x,    initUp.y,    initUp.z],
          cam_forward: [initFwd.x,   initFwd.y,   initFwd.z],
          cam_offset:  [0, 0, 0],
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

    // ── Orbit drag ────────────────────────────────────────────────────────────
    let camElevation    = CAM_THETA_ELEVATION;
    let camPhiOffset    = Math.PI / 2;
    let targetElevation = CAM_THETA_ELEVATION;
    let targetPhiOffset = Math.PI / 2;
    let dragging        = false;
    let lastX           = 0;
    let lastY           = 0;

    // ── Free-look offsets (pointer-lock mode) ─────────────────────────────────
    let lookYaw         = 0;
    let lookPitch       = 0;
    let targetLookYaw   = 0;
    let targetLookPitch = 0;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onMouseMove(e: MouseEvent) {
      if (document.pointerLockElement === mount) {
        targetLookYaw   -= e.movementX * DRAG_SENSITIVITY;
        targetLookPitch -= e.movementY * DRAG_SENSITIVITY;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      targetPhiOffset -= dx * DRAG_SENSITIVITY;
      targetElevation += dy * DRAG_SENSITIVITY;
    }
    function onMouseUp() { dragging = false; }

    // ── Space bar — toggle pointer-lock look mode ─────────────────────────────
    function onPointerLockChange() {
      if (document.pointerLockElement !== mount) {
        // Wrap to [-π, π] so the lerp back to 0 takes the shortest path
        lookYaw   = lookYaw   - Math.round(lookYaw   / (Math.PI * 2)) * Math.PI * 2;
        lookPitch = lookPitch - Math.round(lookPitch / (Math.PI * 2)) * Math.PI * 2;
        targetLookYaw   = 0;
        targetLookPitch = 0;
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (document.pointerLockElement === mount) {
        document.exitPointerLock();
      } else {
        mount.requestPointerLock();
      }
    }

    // ── Scroll distance ───────────────────────────────────────────────────────
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const next = camDistanceRef.current * (1 + e.deltaY * SCROLL_SENSITIVITY * 0.01);
      camDistanceRef.current = Math.max(6, Math.min(50, next));
    }

    mount.addEventListener('mousedown',  onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('keydown',   onKeyDown);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    mount.addEventListener('wheel', onWheel, { passive: false });

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

      // Smooth camera orbit
      camPhiOffset += (targetPhiOffset - camPhiOffset) * 0.12;
      camElevation += (targetElevation - camElevation) * 0.12;

      // Smooth free-look
      lookYaw   += (targetLookYaw   - lookYaw)   * 0.05;
      lookPitch += (targetLookPitch - lookPitch) * 0.05;

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
      const renderTheta = Math.max(0.05, Math.min(Math.PI - 0.05, latestTheta - camElevation));
      const renderPhi   = latestPhi + camPhiOffset;
      const [cx, cy, cz] = blToCartesian(r, renderTheta, renderPhi);
      camera.position.set(cx, cy, cz);
      const [ux, uy, uz] = cameraUp(renderTheta, renderPhi);

      // Camera basis — apply free-look yaw/pitch on top of toward-BH direction
      const baseFwd   = new THREE.Vector3(cx, cy, cz).negate().normalize();
      const baseUp    = new THREE.Vector3(ux, uy, uz);
      const baseRight = new THREE.Vector3().crossVectors(baseFwd, baseUp).normalize();
      const yawQ      = new THREE.Quaternion().setFromAxisAngle(baseUp,    lookYaw);
      const camFwd    = baseFwd.clone().applyQuaternion(yawQ);
      const afterYawRight = new THREE.Vector3().crossVectors(camFwd, baseUp).normalize();
      const pitchQ    = new THREE.Quaternion().setFromAxisAngle(afterYawRight, lookPitch);
      camFwd.applyQuaternion(pitchQ).normalize();
      const camRight  = new THREE.Vector3().crossVectors(camFwd, baseUp).normalize();
      const camUp     = new THREE.Vector3().crossVectors(camRight, camFwd).normalize();

      updateLensingUniforms(lensUniforms, {
        mass:        latestMass,
        spin:        latestSpin,
        cam_r:       r,
        cam_theta:   renderTheta,
        cam_phi:     renderPhi,
        cam_right:   [camRight.x, camRight.y, camRight.z],
        cam_up_vec:  [camUp.x,    camUp.y,    camUp.z],
        cam_forward: [camFwd.x,   camFwd.y,   camFwd.z],
        cam_offset:  [0, 0, 0],
        resolution:  [mount!.clientWidth, mount!.clientHeight],
      });
      lensUniforms.u_frame.value = frameCount++;

      composer.render();
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      mount.removeEventListener('mousedown',  onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
      document.removeEventListener('keydown',   onKeyDown);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      mount.removeEventListener('wheel', onWheel);
      if (document.pointerLockElement === mount) document.exitPointerLock();

      composer.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
  );
}
