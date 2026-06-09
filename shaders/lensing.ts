/**
 * Gravitational lensing post-process pass.
 *
 * Fragment shader integrates null geodesics backward through the Kerr
 * metric using a symplectic Störmer-Verlet integrator per pixel.
 *
 * Key implementation choices (matching reference quality):
 *   - Plane-crossing disk: sample accretion disk exactly at θ=π/2 crossings.
 *     This prevents near-polar orbiting photons from accumulating many
 *     volumetric contributions that produce teardrop/chain-of-dots artifacts.
 *   - Halton-sequence TAA jitter: sub-pixel ray offset cycles through 16
 *     low-discrepancy positions each frame, smoothing photon-ring edges.
 *   - Störmer-Verlet symplectic integrator: preserves the Carter constant
 *     better than RK4 for photons that orbit many times near the photon sphere.
 */

// ── Vertex shader (full-screen quad passthrough) ───────────────────────────

export const LENS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Fragment shader ────────────────────────────────────────────────────────

export const LENS_FRAG = /* glsl */`
  precision highp float;

  // Input scene texture (not used for stars — stars are procedural)
  uniform sampler2D tDiffuse;
  uniform vec2      u_resolution;

  // Black hole / disk parameters
  uniform float u_mass;
  uniform float u_r_inner;   // inner disk edge in M
  uniform float u_r_outer;   // outer disk edge in M
  uniform float u_r_horizon; // event horizon radius in M

  // Observer position in Boyer-Lindquist coords (in M)
  uniform float u_cam_r;
  uniform float u_cam_theta;
  uniform float u_cam_phi;

  // Camera orthonormal basis in world Cartesian (normalised)
  uniform vec3  u_cam_right;
  uniform vec3  u_cam_up_vec;
  uniform vec3  u_cam_forward;
  uniform float u_fov_tan;  // tan(fov/2) = 1.0 for 90° FOV
  uniform float u_spin;     // dimensionless spin a/M ∈ [0, 1)

  // TAA frame counter (float, incremented each rendered frame)
  uniform float u_frame;

  varying vec2 vUv;

  // ─────────────────────────────────────────────────────────────────────────
  const float PI        = 3.14159265358979;
  const float PI_2      = PI * 0.5;
  const int   N_STEPS   = 250;   // symplectic integrator iterations per pixel
  const int   MAX_CROSS = 3;     // max equatorial-plane crossings to accumulate

  // ── Halton low-discrepancy sequence (float version, base b) ─────────────
  float halton(float n, float b) {
    float f = 1.0;
    float r = 0.0;
    float i = n;
    for (int j = 0; j < 16; j++) {
      if (i < 0.5) break;
      f /= b;
      r += f * mod(i, b);
      i  = floor(i / b);
    }
    return r;
  }

  // ── Blackbody colour ramp (cool red → warm orange → hot white) ───────────
  vec3 blackbodyColor(float tf) {
    vec3 cool = vec3(0.72, 0.04, 0.00);
    vec3 warm = vec3(1.00, 0.42, 0.04);
    vec3 hot  = vec3(1.00, 0.92, 0.82);
    return tf > 0.5
      ? mix(warm, hot,  (tf - 0.5) * 2.0)
      : mix(cool, warm, tf * 2.0);
  }

  // ── Analytic disk colour at equatorial crossing (r_M, phi) ──────────────
  vec3 diskColor(float r_M, float phi) {
    float rInner = u_r_inner * u_mass;
    float rOuter = u_r_outer * u_mass;
    if (r_M < rInner || r_M > rOuter) return vec3(0.0);

    // Page-Thorne inner boundary: emission → 0 at ISCO, peaks at ~2-3× rInner
    float pageThorn = max(0.0, 1.0 - sqrt(rInner / r_M));
    float temp      = clamp(pow(rInner / r_M, 0.25), 0.0, 1.0) * pageThorn;
    vec3  col       = blackbodyColor(clamp(pow(rInner / r_M, 0.25), 0.0, 1.0));

    // Keplerian tangential speed (Newtonian, units of c)
    float v_kep  = clamp(sqrt(u_mass / max(r_M, 0.1)), 0.0, 0.92);
    float gamma_ = 1.0 / sqrt(max(1.0 - v_kep * v_kep, 1e-6));

    // Line-of-sight from disk fragment to observer (equatorial projection, M)
    float dx  = u_cam_r * cos(u_cam_phi) - r_M * cos(phi);
    float dz  = u_cam_r * sin(u_cam_phi) - r_M * sin(phi);
    float ll  = length(vec2(dx, dz));

    // β = v_kep · (disk_tangent · LOS_unit); disk tangent = (-sinφ, cosφ)
    float beta = ll > 0.01
      ? v_kep * (-sin(phi) * dx / ll + cos(phi) * dz / ll)
      : 0.0;

    // D^2.5 Doppler beaming, capped to avoid blinding hotspot
    float D    = clamp(1.0 / (gamma_ * (1.0 - beta)), 0.1, 3.5);
    float beam = pow(D, 2.5);

    // Radial fade toward outer edge
    float fade = 1.0 - smoothstep(0.55, 1.0,
                   (r_M - rInner) / (rOuter - rInner));

    return col * beam * temp * fade * 0.50;
  }

  // ── Kerr null geodesic — Boyer-Lindquist Hamilton's equations ───────────
  //
  // State s = (r, θ, p_r, p_θ),  conserved E = √E₂ and angular momentum Lz.
  // Spin parameter a = u_spin · M  (a = 0 → Schwarzschild exactly).
  //
  // Metric quantities:
  //   Σ = r² + a²cos²θ
  //   Δ = r² − 2Mr + a²
  //   P = E(r²+a²) − aLz
  //
  vec4 geodesicDeriv(vec4 s, float Lz, float E2) {
    float r    = max(s.x, 0.05);
    float th   = s.y;
    float pr   = s.z;
    float pth  = s.w;
    float a    = u_spin * u_mass;
    float a2   = a * a;
    float r2   = r * r;
    float cosT = cos(th);
    float sinT = max(abs(sin(th)), 1e-4);
    float sin2 = sinT * sinT;
    float cos2 = cosT * cosT;
    float Sig  = r2 + a2 * cos2;
    float Dl   = max(r2 - 2.0 * u_mass * r + a2, 1e-6);
    float E    = sqrt(max(E2, 1e-6));
    float P    = E * (r2 + a2) - a * Lz;
    float rM   = r - u_mass;

    return vec4(
      Dl / Sig * pr,                                           // dr/dλ
      pth / Sig,                                               // dθ/dλ
      - rM / Sig * pr * pr                                     // dp_r/dλ
        + 2.0 * r * E * P / (Sig * Dl)
        - rM * P * P / (Sig * Dl * Dl),
      cosT * (Lz*Lz - a2*E2*sin2*sin2) / (Sig*sinT*sin2)     // dp_θ/dλ
    );
  }

  // ── Störmer-Verlet symplectic integrator ─────────────────────────────────
  // Order-2 symplectic method: preserves the Poincaré invariants better than
  // RK4 for photons orbiting many times near the photon sphere.
  //
  // Scheme (q = positions, p = momenta):
  //   q_{n+½} = q_n + h/2 · ∂H/∂p(q_n, p_n)
  //   p_{n+1} = p_n + h   · (−∂H/∂q)(q_{n+½}, p_n)
  //   q_{n+1} = q_{n+½}  + h/2 · ∂H/∂p(q_{n+½}, p_{n+1})
  //
  vec4 svStep(vec4 s, float Lz, float E2, float dl) {
    // Half step: advance positions (r, θ) using current momenta
    vec4 d0 = geodesicDeriv(s, Lz, E2);
    vec4 sq = vec4(s.xy + 0.5 * dl * d0.xy, s.zw);

    // Full step: advance momenta (p_r, p_θ) at half-position
    vec4 d1 = geodesicDeriv(sq, Lz, E2);
    vec4 sp = vec4(sq.xy, s.zw + dl * d1.zw);

    // Half step: advance positions with new momenta
    vec4 d2 = geodesicDeriv(sp, Lz, E2);
    return vec4(sp.xy + 0.5 * dl * d2.xy, sp.zw);
  }

  // ── BL coordinate velocity → world Cartesian direction ──────────────────
  vec3 blVelToCartesian(
    float r, float th, float phi,
    float vr, float vth, float vphi
  ) {
    float sinT = sin(th), cosT = cos(th);
    float sinP = sin(phi), cosP = cos(phi);
    return vec3(
      sinT*cosP*vr + r*cosT*cosP*vth - r*sinT*sinP*vphi,
      cosT*vr      - r*sinT*vth,
      sinT*sinP*vr + r*cosT*sinP*vth + r*sinT*cosP*vphi
    );
  }

  // ── Procedural star field (cube-face projection) ──────────────────────────
  vec3 starField(vec3 dir) {
    vec3  ad = abs(dir);
    float face;
    vec2  uv;
    if (ad.x >= ad.y && ad.x >= ad.z) {
      face = dir.x > 0.0 ? 0.0 : 1.0;
      uv   = (dir.x > 0.0 ? vec2(-dir.z,  dir.y)
                           : vec2( dir.z,  dir.y)) / ad.x;
    } else if (ad.y >= ad.z) {
      face = dir.y > 0.0 ? 2.0 : 3.0;
      uv   = (dir.y > 0.0 ? vec2( dir.x, -dir.z)
                           : vec2( dir.x,  dir.z)) / ad.y;
    } else {
      face = dir.z > 0.0 ? 4.0 : 5.0;
      uv   = (dir.z > 0.0 ? vec2( dir.x,  dir.y)
                           : vec2(-dir.x,  dir.y)) / ad.z;
    }

    const float GRID = 45.0;
    vec2 guv        = uv * GRID;
    vec2 cell       = floor(guv);
    vec2 fr         = fract(guv);
    vec2 faceOffset = vec2(face * 113.0, face * 97.0);

    vec3 col = vec3(0.0);
    for (int ix = -1; ix <= 1; ix++) {
    for (int iy = -1; iy <= 1; iy++) {
      vec2  nc      = cell + vec2(float(ix), float(iy)) + faceOffset;
      float h1      = fract(sin(dot(nc, vec2(127.1, 311.7))) * 43758.5453);
      float h2      = fract(sin(dot(nc, vec2(269.5, 183.3))) * 43758.5453);
      float h3      = fract(sin(dot(nc, vec2(419.2, 371.9))) * 43758.5453);
      float hasStar = step(h1, 0.05);
      vec2  sp      = vec2(h2, h3);
      float dist    = length(fr - sp - vec2(float(ix), float(iy)));
      float brightness = exp(-dist * dist * 60.0)
                       * (0.4 + h1 * 12.0)
                       * hasStar;
      vec3  sc = h1 < 0.015 ? vec3(0.75, 0.88, 1.00)
               : h1 < 0.030 ? vec3(1.00, 0.80, 0.55)
               :               vec3(1.00, 1.00, 1.00);
      col += sc * brightness;
    }
    }
    return clamp(col, 0.0, 3.0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  void main() {
    float aspect = u_resolution.x / u_resolution.y;

    // ── Halton jitter for temporal anti-aliasing ───────────────────────────
    // Cycles through 16 low-discrepancy sub-pixel offsets each frame.
    // Shifts the photon-ring sample positions by up to ±0.5 px, distributing
    // discrete crossing samples across the ring width over time.
    float fn  = mod(u_frame, 16.0) + 1.0;
    float jx  = halton(fn, 2.0) - 0.5;   // (-0.5, 0.5) pixels
    float jy  = halton(fn, 3.0) - 0.5;

    vec2  ndc = vUv * 2.0 - 1.0
              + vec2(jx / u_resolution.x, jy / u_resolution.y) * 2.0;

    vec3 ray = normalize(
      u_cam_forward
      + ndc.x * u_fov_tan * aspect * u_cam_right
      + ndc.y * u_fov_tan * u_cam_up_vec
    );

    // ── Observer position in BL ────────────────────────────────────────────
    float r0    = u_cam_r;
    float th0   = u_cam_theta;
    float phi0  = u_cam_phi;
    float sinT0 = sin(th0), cosT0 = cos(th0);
    float sinP0 = sin(phi0), cosP0 = cos(phi0);
    float a0    = u_spin * u_mass;
    float Sig0  = r0*r0 + a0*a0*cosT0*cosT0;
    float Dl0   = r0*r0 - 2.0*u_mass*r0 + a0*a0;
    float E2    = max((Sig0 - 2.0*u_mass*r0) / Sig0, 1e-6);
    float E     = sqrt(E2);

    float escapeR = max(50.0, u_r_outer * u_mass * 3.0);

    // ── Decompose ray into BL momenta via Kerr tetrad ─────────────────────
    vec3 e_r   = vec3(sinT0*cosP0,  cosT0,  sinT0*sinP0);
    vec3 e_th  = vec3(cosT0*cosP0, -sinT0,  cosT0*sinP0);
    vec3 e_phi = vec3(-sinP0,       0.0,    cosP0);

    float n_r   = dot(ray, e_r);
    float n_th  = dot(ray, e_th);
    float n_phi = dot(ray, e_phi);

    float Lz = n_phi * r0 * sinT0;
    vec4  s  = vec4(r0, th0,
                    n_r  * sqrt(max(Sig0 / max(Dl0, 1e-6), 0.0)),
                    n_th * sqrt(Sig0));
    float phi = phi0;

    // ── Main geodesic loop ─────────────────────────────────────────────────
    // Plane-crossing disk: accumulate disk emission only at exact θ=π/2
    // crossings.  This prevents near-polar orbiting photons from building up
    // many Gaussian contributions that create the teardrop/chain-of-dots
    // artifact near the photon ring.
    vec3  diskAccum = vec3(0.0);
    float diskAlpha = 0.0;
    int   crossings = 0;

    vec4  prevS   = s;
    float prevPhi = phi;

    for (int i = 0; i < N_STEPS; i++) {

      // ── Adaptive step size ──────────────────────────────────────────────
      float dl = 0.5 * max(s.x / max(5.0 * u_mass, 1.0), 0.05);

      // ── Save state before advancing (for crossing interpolation) ────────
      prevS   = s;
      prevPhi = phi;

      // ── Advance φ (Kerr: frame-dragging term 2aMrE/Δ) ──────────────────
      float a_ph    = u_spin * u_mass;
      float a2_ph   = a_ph * a_ph;
      float r2_ph   = s.x * s.x;
      float sinT_ph = max(abs(sin(s.y)), 1e-4);
      float sin2_ph = sinT_ph * sinT_ph;
      float Sig_ph  = r2_ph + a2_ph * (1.0 - sin2_ph);
      float Dl_ph   = max(r2_ph - 2.0*u_mass*s.x + a2_ph, 1e-6);
      phi += (Lz*(Dl_ph - a2_ph*sin2_ph)/(Dl_ph*sin2_ph)
              + 2.0*a_ph*u_mass*s.x*E/Dl_ph) / Sig_ph * dl;

      // ── Störmer-Verlet step for (r, θ, p_r, p_θ) ───────────────────────
      s = svStep(s, Lz, E2, dl);

      // ── Equatorial plane crossing detection ─────────────────────────────
      // Detect sign change of (θ − π/2) between prevS and s.  Interpolate
      // linearly to find the exact crossing position and φ, then sample the
      // disk once.  Limited to MAX_CROSS crossings to cap higher-order ring
      // images without discarding the direct + first-lensed images.
      if (crossings < MAX_CROSS) {
        float dPrev = prevS.y - PI_2;
        float dCurr = s.y    - PI_2;
        if (dPrev * dCurr <= 0.0) {
          float denom = dCurr - dPrev;
          float t     = abs(denom) > 1e-8 ? clamp(-dPrev / denom, 0.0, 1.0) : 0.5;
          float rCross   = mix(prevS.x, s.x, t);
          float phiCross = prevPhi + t * (phi - prevPhi);

          vec3  col    = diskColor(rCross, phiCross);
          float weight = max(0.0, 1.0 - diskAlpha);
          diskAccum   += col * weight;
          // Increase alpha proportional to brightness so bright inner disk
          // saturates quickly and outer-disk lower crossings are still visible
          float bright = length(col);
          if (bright > 1e-4) {
            diskAlpha = min(diskAlpha + weight * min(bright * 3.0, 0.95), 0.99);
          }
          crossings++;
        }
      }

      // ── Horizon — absorb the ray ─────────────────────────────────────────
      float rPlus = u_mass + sqrt(max(u_mass*u_mass*(1.0 - u_spin*u_spin), 0.0));
      if (s.x < rPlus + 0.1) {
        gl_FragColor = vec4(diskAccum, 1.0);
        return;
      }

      // ── Escape — sample the warped background ──────────────────────────
      if (s.x > escapeR) {
        float a_e    = u_spin * u_mass;
        float a2_e   = a_e * a_e;
        float r2_e   = s.x * s.x;
        float sinTE  = max(abs(sin(s.y)), 1e-4);
        float sin2_e = sinTE * sinTE;
        float Sig_e  = r2_e + a2_e * (1.0 - sin2_e);
        float Dl_e   = max(r2_e - 2.0*u_mass*s.x + a2_e, 1e-6);
        vec3 escDir  = normalize(blVelToCartesian(
          s.x, s.y, phi,
          Dl_e / Sig_e * s.z,
          s.w / Sig_e,
          (Lz*(Dl_e - a2_e*sin2_e)/(Dl_e*sin2_e) + 2.0*a_e*u_mass*s.x*E/Dl_e) / Sig_e
        ));
        gl_FragColor = vec4(starField(escDir) + diskAccum, 1.0);
        return;
      }
    }

    // Max iterations: ray trapped near photon sphere — output disk only.
    gl_FragColor = vec4(diskAccum, 1.0);
  }
`;

// ── TypeScript API ─────────────────────────────────────────────────────────

export interface LensingUniformData {
  /** Black hole mass in M (geometrized units). */
  mass:    number;
  /** Dimensionless spin parameter a/M ∈ [0, 1). */
  spin:    number;
  /** Observer radial coordinate in M. */
  cam_r:   number;
  /** Observer polar angle in radians (π/2 = equatorial). */
  cam_theta: number;
  /** Observer azimuthal angle in radians. */
  cam_phi: number;
  /** Camera right vector in world Cartesian. */
  cam_right:   [number, number, number];
  /** Camera up vector in world Cartesian. */
  cam_up_vec:  [number, number, number];
  /** Camera forward vector (toward BH) in world Cartesian. */
  cam_forward: [number, number, number];
  /** Viewport dimensions in pixels. */
  resolution: [number, number];
}

export type LensingUniforms = Record<string, { value: unknown }>;

/**
 * Build the initial uniforms object for the lensing ShaderPass.
 */
export function createLensingUniforms(
  data:       LensingUniformData,
  rInnerM     = 2.1,
  rOuterM     = 25.0,
  rHorizonM   = 2.0,
): LensingUniforms {
  return {
    tDiffuse:      { value: null },
    u_resolution:  { value: data.resolution },
    u_mass:        { value: data.mass },
    u_r_inner:     { value: rInnerM },
    u_r_outer:     { value: rOuterM },
    u_r_horizon:   { value: rHorizonM },
    u_cam_r:       { value: data.cam_r },
    u_cam_theta:   { value: data.cam_theta },
    u_cam_phi:     { value: data.cam_phi },
    u_cam_right:   { value: data.cam_right },
    u_cam_up_vec:  { value: data.cam_up_vec },
    u_cam_forward: { value: data.cam_forward },
    u_fov_tan:     { value: 1.0 },
    u_spin:        { value: data.spin },
    u_frame:       { value: 0.0 },
  };
}

/**
 * Update per-frame observer / BH uniforms in place.
 * Geometry bounds (r_inner, r_outer, r_horizon) and fov_tan are static.
 */
export function updateLensingUniforms(
  uniforms: LensingUniforms,
  data:     LensingUniformData,
): void {
  uniforms.u_mass.value        = data.mass;
  uniforms.u_spin.value        = data.spin;
  const a = data.spin * data.mass;
  uniforms.u_r_horizon.value   = data.mass + Math.sqrt(Math.max(data.mass * data.mass - a * a, 0));
  uniforms.u_cam_r.value       = data.cam_r;
  uniforms.u_cam_theta.value   = data.cam_theta;
  uniforms.u_cam_phi.value     = data.cam_phi;
  uniforms.u_cam_right.value   = data.cam_right;
  uniforms.u_cam_up_vec.value  = data.cam_up_vec;
  uniforms.u_cam_forward.value = data.cam_forward;
  uniforms.u_resolution.value  = data.resolution;
}

export const LENSING_SHADER = {
  vertexShader:   LENS_VERT,
  fragmentShader: LENS_FRAG,
} as const;
