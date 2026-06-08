/**
 * Accretion disk ShaderMaterial.
 *
 * Fragment shader computes per-fragment:
 *   - Temperature-gradient colour  T ∝ r^{-3/4}  (hot white inner, cool red outer)
 *   - Relativistic Doppler beaming from Keplerian rotation  D^3
 *
 * Designed for AdditiveBlending — outputs emissive RGB with alpha=1.
 * Bloom post-processing (added in a later pass) will amplify the bright regions.
 */

import * as THREE from 'three';

// ── Vertex shader ─────────────────────────────────────────────────────────────

export const DISK_VERT = /* glsl */`
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos   = modelMatrix * vec4(position, 1.0);
    vWorldPos       = worldPos.xyz;
    gl_Position     = projectionMatrix * viewMatrix * worldPos;
  }
`;

// ── Fragment shader ───────────────────────────────────────────────────────────

export const DISK_FRAG = /* glsl */`
  precision highp float;

  // Disk geometry bounds (in M units)
  uniform float u_r_inner;
  uniform float u_r_outer;
  // World-units per M (WORLD_SCALE)
  uniform float u_world_scale;

  // Kerr parameters
  uniform float u_mass;
  uniform float u_spin;

  // Observer position (equatorial)
  uniform float u_obs_r;    // in M
  uniform float u_obs_phi;  // in radians

  varying vec3 vWorldPos;

  // Three-stop colour ramp: cool (deep red) → warm (orange) → hot (white)
  vec3 blackbodyColor(float tf) {
    vec3 cool = vec3(0.72, 0.04, 0.00);
    vec3 warm = vec3(1.00, 0.42, 0.04);
    vec3 hot  = vec3(1.00, 0.92, 0.82);
    if (tf > 0.5) return mix(warm, hot,  (tf - 0.5) * 2.0);
    return             mix(cool, warm, tf * 2.0);
  }

  void main() {
    // ── Disk-plane radius --------------------------------------------------
    float r_world = length(vWorldPos.xz);
    float r_M     = r_world / u_world_scale;

    if (r_M < u_r_inner || r_M > u_r_outer) discard;

    // ── Temperature gradient  T ∝ r^{-3/4} --------------------------------
    float temp = clamp(pow(u_r_inner / r_M, 0.75), 0.0, 1.0);
    vec3  col  = blackbodyColor(temp);

    // ── Keplerian tangential speed (Newtonian approx, units of c) ----------
    //   v = sqrt(M / r)
    float v_kep = clamp(sqrt(u_mass / max(r_M, 0.1)), 0.0, 0.92);

    // ── Relativistic Doppler beaming  D = 1 / (γ (1 - β)) -----------------
    float phi_d = atan(vWorldPos.z, vWorldPos.x);

    // Observer world position projected to equatorial plane
    float obs_wx = u_obs_r * cos(u_obs_phi) * u_world_scale;
    float obs_wz = u_obs_r * sin(u_obs_phi) * u_world_scale;

    // Unit vector from disk fragment toward observer (equatorial projection)
    float los_x  = obs_wx - vWorldPos.x;
    float los_z  = obs_wz - vWorldPos.z;
    float los_len = length(vec2(los_x, los_z));

    // β = v_kep · (v̂_disk · n̂_los),  disk velocity direction = (-sin φ, cos φ)
    float beta = 0.0;
    if (los_len > 0.01) {
      beta = v_kep * (
        -sin(phi_d) * (los_x / los_len) +
         cos(phi_d) * (los_z / los_len)
      );
    }

    float gamma_  = 1.0 / sqrt(max(1.0 - v_kep * v_kep, 1e-6));
    float D       = clamp(1.0 / (gamma_ * (1.0 - beta)), 0.05, 5.0);
    float beam    = pow(D, 3.0);   // D^4 physically correct; D^3 avoids
                                    // blowout before bloom pass is added

    // ── Radial fade at outer edge ------------------------------------------
    float t    = (r_M - u_r_inner) / (u_r_outer - u_r_inner);
    float fade = 1.0 - smoothstep(0.55, 1.0, t);

    // Scale keeps each additive layer from blowing out; bloom amplifies later
    float brightness = 0.18;
    vec3  emissive   = col * beam * temp * fade * brightness;

    gl_FragColor = vec4(emissive, 1.0);
  }
`;

// ── TypeScript API ────────────────────────────────────────────────────────────

export interface DiskUniformData {
  mass:    number;
  spin:    number;
  obs_r:   number; // observer radial coord in M
  obs_phi: number; // observer azimuthal coord in radians
}

/**
 * Build a ShaderMaterial for the accretion disk.
 *
 * @param data       Initial observer/BH state
 * @param rInnerM    Inner disk radius in M  (default 2.1)
 * @param rOuterM    Outer disk radius in M  (default 25.0)
 * @param worldScale M → world-unit conversion (default 100)
 */
export function createDiskMaterial(
  data:       DiskUniformData,
  rInnerM     = 2.1,
  rOuterM     = 25.0,
  worldScale  = 100.0,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   DISK_VERT,
    fragmentShader: DISK_FRAG,
    uniforms: {
      u_mass:        { value: data.mass },
      u_spin:        { value: data.spin },
      u_r_inner:     { value: rInnerM },
      u_r_outer:     { value: rOuterM },
      u_world_scale: { value: worldScale },
      u_obs_r:       { value: data.obs_r },
      u_obs_phi:     { value: data.obs_phi },
    },
    side:       THREE.DoubleSide,
    transparent: true,
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/**
 * Update per-frame observer uniforms. Call once per animation frame.
 * The r_inner / r_outer / world_scale uniforms are static and never need updating.
 */
export function updateDiskUniforms(
  mat:  THREE.ShaderMaterial,
  data: DiskUniformData,
): void {
  mat.uniforms.u_mass.value    = data.mass;
  mat.uniforms.u_spin.value    = data.spin;
  mat.uniforms.u_obs_r.value   = data.obs_r;
  mat.uniforms.u_obs_phi.value = data.obs_phi;
}
