/**
 * Gravitational lensing post-process pass.
 *
 * Fragment shader integrates null geodesics backward through the Schwarzschild
 * metric using RK4 per pixel, producing:
 *   - Black hole shadow (photon escape boundary)
 *   - Photon ring (geodesics that orbit near r = 3M)
 *   - Warped star field (background UV deflection)
 *   - Primary + secondary accretion disk images (disk colour computed analytically)
 *
 * Designed to run as a Three.js ShaderPass via EffectComposer.
 * The previous RenderPass writes the star field to tDiffuse; the lensing pass
 * warps it and composites the disk on top.
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

  // Input scene (star field rendered by RenderPass)
  uniform sampler2D tDiffuse;
  uniform vec2      u_resolution;

  // Black hole / disk parameters
  uniform float u_mass;
  uniform float u_r_inner;   // inner disk edge in M
  uniform float u_r_outer;   // outer disk edge in M
  uniform float u_r_horizon; // event horizon radius in M  (= 2M for Schwarzschild)

  // Observer position in Boyer-Lindquist coords (in M)
  uniform float u_cam_r;
  uniform float u_cam_theta;
  uniform float u_cam_phi;

  // Camera orthonormal basis in world Cartesian (normalised)
  // Convention: y = polar axis, disk in xz-plane
  uniform vec3  u_cam_right;
  uniform vec3  u_cam_up_vec;
  uniform vec3  u_cam_forward;
  uniform float u_fov_tan;  // tan(fov / 2);  = 1.0 for 90° FOV

  varying vec2 vUv;

  // ─────────────────────────────────────────────────────────────────────────
  const float PI      = 3.14159265358979;
  const int   N_STEPS = 150;   // RK4 iterations per pixel
  const float ESCAPE  = 50.0;  // escape radius in M (far enough from BH)

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
  // Replicates the disk shader's temperature gradient + Doppler beaming.
  vec3 diskColor(float r_M, float phi) {
    if (r_M < u_r_inner || r_M > u_r_outer) return vec3(0.0);

    // Temperature gradient  T ∝ r^{-3/4}
    float temp   = clamp(pow(u_r_inner / r_M, 0.75), 0.0, 1.0);
    vec3  col    = blackbodyColor(temp);

    // Keplerian tangential speed (Newtonian,  units of c)
    float v_kep  = clamp(sqrt(u_mass / max(r_M, 0.1)), 0.0, 0.92);
    float gamma_ = 1.0 / sqrt(max(1.0 - v_kep * v_kep, 1e-6));

    // Line-of-sight from disk fragment to observer (equatorial projection, M)
    float dx  = u_cam_r * cos(u_cam_phi) - r_M * cos(phi);
    float dz  = u_cam_r * sin(u_cam_phi) - r_M * sin(phi);
    float ll  = length(vec2(dx, dz));

    // β = v_kep · (disk_tangent · LOS_unit);  disk tangent = (-sin φ, cos φ)
    float beta = ll > 0.01
      ? v_kep * (-sin(phi) * dx / ll + cos(phi) * dz / ll)
      : 0.0;

    float D    = clamp(1.0 / (gamma_ * (1.0 - beta)), 0.05, 5.0);
    float beam = pow(D, 3.0);  // D^3 Doppler beaming

    // Radial fade toward outer edge
    float fade = 1.0 - smoothstep(0.55, 1.0,
                   (r_M - u_r_inner) / (u_r_outer - u_r_inner));

    return col * beam * temp * fade * 0.18;
  }

  // ── Schwarzschild null geodesic — Hamilton's equations ───────────────────
  //
  // State s = (r, θ, p_r, p_θ),  conserved angular momentum Lz.
  // Setting E = 1 (overall scale irrelevant for null geodesics).
  //
  // Hamiltonian:
  //   H = ½[ −1/f + f·p_r² + p_θ²/r² + Lz²/(r²sin²θ) ] = 0
  //
  // where  f = 1 − 2M/r.
  //
  // Equations of motion:
  //   dr/dλ   = f · p_r
  //   dθ/dλ   = p_θ / r²
  //   dp_r/dλ = −M/(r²f²) − M·p_r²/r² + p_θ²/r³ + Lz²/(r³sin²θ)
  //   dp_θ/dλ = Lz²·cosθ / (r²sin³θ)
  //
  // dφ/dλ = Lz / (r²sin²θ)  is integrated separately (φ is cyclic).
  //
  vec4 geodesicDeriv(vec4 s, float Lz) {
    float r    = max(s.x, 0.1);
    float th   = s.y;
    float pr   = s.z;
    float pth  = s.w;

    float f    = max(1.0 - 2.0 * u_mass / r, 1e-6);
    float r2   = r * r;
    float r3   = r2 * r;
    float sinT = max(abs(sin(th)), 1e-4);
    float cosT = cos(th);
    float sin2 = sinT * sinT;

    return vec4(
      f * pr,                                            // dr/dλ
      pth / r2,                                          // dθ/dλ
      -u_mass / (r2 * f * f)                             // dp_r/dλ
        - u_mass * pr * pr / r2
        + pth * pth / r3
        + Lz * Lz / (r3 * sin2),
      Lz * Lz * cosT / (r2 * sin2 * sinT)               // dp_θ/dλ
    );
  }

  // ── Classic RK4 integrator step ──────────────────────────────────────────
  vec4 rk4Step(vec4 s, float Lz, float dl) {
    vec4 k1 = geodesicDeriv(s,               Lz);
    vec4 k2 = geodesicDeriv(s + 0.5*dl*k1,  Lz);
    vec4 k3 = geodesicDeriv(s + 0.5*dl*k2,  Lz);
    vec4 k4 = geodesicDeriv(s +     dl*k3,  Lz);
    return s + (dl / 6.0) * (k1 + 2.0*k2 + 2.0*k3 + k4);
  }

  // ── BL coordinate velocity → world Cartesian direction ──────────────────
  // Given position (r, θ, φ) and velocity components (vr, vθ, vφ) in BL,
  // returns the corresponding Cartesian 3-vector.
  //
  // Jacobian  ∂(x,y,z)/∂(r,θ,φ):
  //   dx = sinθ cosφ dr + r cosθ cosφ dθ − r sinθ sinφ dφ
  //   dy = cosθ dr   − r sinθ dθ
  //   dz = sinθ sinφ dr + r cosθ sinφ dθ + r sinθ cosφ dφ
  //
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

  // ── Project a world-space direction to UV screen coordinates ────────────
  vec2 dirToUV(vec3 d) {
    float dotF = dot(d, u_cam_forward);
    if (dotF <= 0.001) return vUv;  // behind camera — keep pixel as-is
    float aspect = u_resolution.x / u_resolution.y;
    float pR = dot(d, u_cam_right)  / dotF;
    float pU = dot(d, u_cam_up_vec) / dotF;
    return vec2(pR / (u_fov_tan * aspect), pU / u_fov_tan) * 0.5 + 0.5;
  }

  // ─────────────────────────────────────────────────────────────────────────
  void main() {
    // ── Reconstruct ray direction from this pixel's UV ─────────────────────
    float aspect = u_resolution.x / u_resolution.y;
    vec2  ndc    = vUv * 2.0 - 1.0;
    vec3  ray    = normalize(
      u_cam_forward
      + ndc.x * u_fov_tan * aspect * u_cam_right
      + ndc.y * u_fov_tan * u_cam_up_vec
    );

    // ── Observer position in BL ────────────────────────────────────────────
    float r0    = u_cam_r;
    float th0   = u_cam_theta;
    float phi0  = u_cam_phi;
    float f0    = max(1.0 - 2.0 * u_mass / r0, 1e-4);

    // ── Decompose ray direction into local tetrad components ───────────────
    //
    // At static observer in Schwarzschild, the orthonormal tetrad coframe:
    //   ê_r̂ = (sinθ cosφ, cosθ, sinθ sinφ)   unit radial in Cartesian
    //   ê_θ̂ = (cosθ cosφ, −sinθ, cosθ sinφ)  unit polar  in Cartesian
    //   ê_φ̂ = (−sinφ,     0,     cosφ)        unit azimuthal in Cartesian
    //
    // Tetrad → BL momenta (E = 1):
    //   p_r   = n_r̂ / √f
    //   p_θ   = n_θ̂ · r₀
    //   Lz    = n_φ̂ · r₀ sinθ₀
    //
    float sinT0 = sin(th0), cosT0 = cos(th0);
    float sinP0 = sin(phi0), cosP0 = cos(phi0);

    vec3 e_r   = vec3(sinT0*cosP0,  cosT0,  sinT0*sinP0);
    vec3 e_th  = vec3(cosT0*cosP0, -sinT0,  cosT0*sinP0);
    vec3 e_phi = vec3(-sinP0,       0.0,    cosP0);

    float n_r   = dot(ray, e_r);
    float n_th  = dot(ray, e_th);
    float n_phi = dot(ray, e_phi);

    float Lz = n_phi * r0 * sinT0;
    vec4  s  = vec4(r0, th0, n_r / sqrt(f0), n_th * r0);
    float phi = phi0;

    // ── Main geodesic loop ─────────────────────────────────────────────────
    float prevCosT  = cos(s.y);
    float prevR     = s.x;
    float prevPhi   = phi;
    vec3  diskAccum = vec3(0.0);
    int   diskHits  = 0;

    for (int i = 0; i < N_STEPS; i++) {

      // ── Detect disk plane crossing (cos θ changes sign → θ crosses π/2) ─
      float currCosT = cos(s.y);
      if (prevCosT * currCosT < 0.0 && diskHits < 3) {
        // Linearly interpolate to find r and φ at the crossing
        float frac  = abs(prevCosT) / (abs(prevCosT) + abs(currCosT));
        float r_hit = mix(prevR,   s.x, frac);
        float p_hit = mix(prevPhi, phi, frac);
        diskAccum  += diskColor(r_hit, p_hit);
        diskHits++;
      }
      prevCosT = currCosT;
      prevR    = s.x;
      prevPhi  = phi;

      // ── Adaptive step size: smaller near the horizon ───────────────────
      float dl = 0.5 * max(s.x / max(5.0 * u_mass, 1.0), 0.05);

      // ── Advance φ with Euler using current-step values ─────────────────
      float sinT2 = max(sin(s.y) * sin(s.y), 1e-8);
      phi += Lz / (s.x * s.x * sinT2) * dl;

      // ── RK4 step for (r, θ, p_r, p_θ) ────────────────────────────────
      s = rk4Step(s, Lz, dl);

      // ── Horizon — absorb the ray ─────────────────────────────────────────
      if (s.x < u_r_horizon + 0.1) {
        gl_FragColor = vec4(diskAccum, 1.0);
        return;
      }

      // ── Escape — sample the warped background ──────────────────────────
      if (s.x > ESCAPE) {
        float f_esc = 1.0 - 2.0 * u_mass / s.x;
        float sinTE = max(abs(sin(s.y)), 1e-4);
        float dphi  = Lz / (s.x * s.x * sinTE * sinTE);
        vec3 escDir = normalize(blVelToCartesian(
          s.x, s.y, phi,
          f_esc * s.z,          // dr/dλ  = f · p_r
          s.w / (s.x * s.x),   // dθ/dλ  = p_θ / r²
          dphi                  // dφ/dλ  = Lz / (r² sin²θ)
        ));
        vec2 uv  = clamp(dirToUV(escDir), 0.001, 0.999);
        vec3 bg  = texture2D(tDiffuse, uv).rgb;
        gl_FragColor = vec4(bg + diskAccum, 1.0);
        return;
      }
    }

    // Max iterations: ray trapped near photon sphere → faint ring glow
    gl_FragColor = vec4(diskAccum + vec3(0.03, 0.015, 0.0), 1.0);
  }
`;

// ── TypeScript API ─────────────────────────────────────────────────────────

export interface LensingUniformData {
  /** Black hole mass in M (geometrized units). */
  mass:    number;
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
 *
 * @param data       Observer / BH state
 * @param rInnerM    Inner disk edge in M  (default 2.1)
 * @param rOuterM    Outer disk edge in M  (default 25.0)
 * @param rHorizonM  Event horizon radius in M  (default 2.0 for Schwarzschild)
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
    u_fov_tan:     { value: 1.0 },  // tan(45°) for 90° FOV
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
  uniforms.u_cam_r.value       = data.cam_r;
  uniforms.u_cam_theta.value   = data.cam_theta;
  uniforms.u_cam_phi.value     = data.cam_phi;
  uniforms.u_cam_right.value   = data.cam_right;
  uniforms.u_cam_up_vec.value  = data.cam_up_vec;
  uniforms.u_cam_forward.value = data.cam_forward;
  uniforms.u_resolution.value  = data.resolution;
}

/**
 * Shader definition object for constructing a Three.js ShaderPass.
 * Build the pass in the component to avoid importing three/examples/jsm here.
 *
 * Usage:
 *   import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
 *   const pass = new ShaderPass({
 *     uniforms:       createLensingUniforms(initialData),
 *     vertexShader:   LENS_VERT,
 *     fragmentShader: LENS_FRAG,
 *   });
 */
export const LENSING_SHADER = {
  vertexShader:   LENS_VERT,
  fragmentShader: LENS_FRAG,
} as const;
