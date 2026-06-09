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
  WORLD_SCALE,
} from '@/lib/coordinates';
import {
  LENS_VERT,
  LENS_FRAG,
  createLensingUniforms,
  updateLensingUniforms,
  type LensingUniforms,
} from '@/shaders/lensing';

// Inner edge = Schwarzschild ISCO = 6M.  Extending inside ISCO put extremely
// hot, over-bright material near the photon sphere, creating garish stripes.
// Outer edge trimmed to 15M — dim outer disk contributed faint extra rings.
const DISK_INNER_M  = 6.0;
const DISK_OUTER_M  = 15.0;
// Elevation above the equatorial plane (radians).
// A purely equatorial camera sees an infinitely-thin disk edge-on — direct
// disk rays never cross the midplane and are invisible to the shader's
// plane-crossing detector.  A small tilt brings direct disk rays into view.
const CAM_THETA_ELEVATION = 0.2;

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
      1e6,
    );
    const [icx, icy, icz] = blToCartesian(8, Math.PI / 2 - CAM_THETA_ELEVATION, Math.PI / 2);
    camera.position.set(icx, icy, icz);
    const [iux, iuy, iuz] = cameraUp(Math.PI / 2 - CAM_THETA_ELEVATION, Math.PI / 2);
    camera.up.set(iux, iuy, iuz);
    camera.lookAt(0, 0, 0);

    // Stars are drawn procedurally by the lensing shader's starField() function.

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
    const initialR = 8.0; // M
    // Camera starts elevated CAM_THETA_ELEVATION radians above the equatorial
    // plane.  A purely equatorial camera sees the disk edge-on and the primary
    // disk image is invisible to the plane-crossing detector.
    const initialTheta = Math.PI / 2 - CAM_THETA_ELEVATION;
    const initialPhi   = Math.PI / 2; // camera on +Z axis → φ = π/2
    // Derive initial basis from the camera we already positioned above.
    camera.updateMatrixWorld();
    const initFwdV  = camera.position.clone().negate().normalize();
    const initUpV   = camera.up.clone().normalize();
    const initRightV = new THREE.Vector3().crossVectors(initFwdV, initUpV).normalize();
    const initialFwd:   [number, number, number] = [initFwdV.x,   initFwdV.y,   initFwdV.z];
    const initialRight: [number, number, number] = [initRightV.x, initRightV.y, initRightV.z];
    const initialUp:    [number, number, number] = [initUpV.x,    initUpV.y,    initUpV.z];

    const lensingPass = new ShaderPass({
      uniforms: createLensingUniforms(
        {
          mass:        1.0,
          cam_r:       initialR,
          cam_theta:   initialTheta,
          cam_phi:     initialPhi,
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
          // Camera follows the observer's geodesic, elevated above the disk plane
          // so the lensing shader's plane-crossing detector sees the primary disk image.
          const renderTheta = frame.theta - CAM_THETA_ELEVATION;
          const [cx, cy, cz] = blToCartesian(frame.r, renderTheta, frame.phi);
          camera.position.set(cx, cy, cz);
          const [ux, uy, uz] = cameraUp(renderTheta, frame.phi);
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
            cam_theta:   renderTheta,
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
