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
  // u_r_inner / u_r_outer are stored in multiples of M; scale by u_mass to
  // get absolute Boyer-Lindquist coordinates for any black hole mass.
  vec3 diskColor(float r_M, float phi) {
    float rInner = u_r_inner * u_mass;
    float rOuter = u_r_outer * u_mass;
    if (r_M < rInner || r_M > rOuter) return vec3(0.0);

    // Temperature gradient  T ∝ r^{-1/4}  (shallow — avoids strong radial
    // colour banding that becomes visually dominant under extreme lensing)
    float temp   = clamp(pow(rInner / r_M, 0.25), 0.0, 1.0);
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

    // D^2.5 beaming — less extreme than D^3, capped at 3.5 to avoid a
    // blinding hot-spot on the approaching side.
    float D    = clamp(1.0 / (gamma_ * (1.0 - beta)), 0.1, 3.5);
    float beam = pow(D, 2.5);

    // Radial fade toward outer edge
    float fade = 1.0 - smoothstep(0.55, 1.0,
                   (r_M - rInner) / (rOuter - rInner));

    return col * beam * temp * fade * 0.12;
  }

  // ── Schwarzschild null geodesic — Hamilton's equations ───────────────────
  //
  // State s = (r, θ, p_r, p_θ),  conserved angular momentum Lz.
  //
  // The local tetrad sets p^(t̂) = 1 at the observer, giving conserved
  // BL energy E_BL = √f₀  (where f₀ = f(r_observer)).  We carry E₀² = f₀
  // as a constant so the Hamiltonian H = 0 is satisfied exactly.
  //
  // Hamiltonian:
  //   H = ½[ −E₀²/f + f·p_r² + p_θ²/r² + Lz²/(r²sin²θ) ] = 0
  //
  // Equations of motion  (E₀² multiplies only the first dp_r term):
  //   dr/dλ   = f · p_r
  //   dθ/dλ   = p_θ / r²
  //   dp_r/dλ = −E₀²·M/(r²f²) − M·p_r²/r² + p_θ²/r³ + Lz²/(r³sin²θ)
  //   dp_θ/dλ = Lz²·cosθ / (r²sin³θ)
  //
  // dφ/dλ = Lz / (r²sin²θ)  is integrated separately (φ is cyclic).
  //
  vec4 geodesicDeriv(vec4 s, float Lz, float E2) {
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
      -E2 * u_mass / (r2 * f * f)                        // dp_r/dλ  ← E₀² factor
        - u_mass * pr * pr / r2
        + pth * pth / r3
        + Lz * Lz / (r3 * sin2),
      Lz * Lz * cosT / (r2 * sin2 * sinT)               // dp_θ/dλ
    );
  }

  // ── Classic RK4 integrator step ──────────────────────────────────────────
  vec4 rk4Step(vec4 s, float Lz, float E2, float dl) {
    vec4 k1 = geodesicDeriv(s,               Lz, E2);
    vec4 k2 = geodesicDeriv(s + 0.5*dl*k1,  Lz, E2);
    vec4 k3 = geodesicDeriv(s + 0.5*dl*k2,  Lz, E2);
    vec4 k4 = geodesicDeriv(s +     dl*k3,  Lz, E2);
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

  // ── Procedural star field ─────────────────────────────────────────────────
  // Cube-face projection: project dir onto the dominant cube face to get a
  // uniform 2D grid.  Avoids the equirectangular pole singularity that
  // produced dark teardrop artefacts at the top/bottom of the shadow.
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
    vec2 guv        = uv * GRID;   // [−45, 45]
    vec2 cell       = floor(guv);
    vec2 fr         = fract(guv);
    // Offset cell coords by face so each face uses a disjoint region of hash space
    vec2 faceOffset = vec2(face * 113.0, face * 97.0);

    vec3 col = vec3(0.0);
    for (int ix = -1; ix <= 1; ix++) {
    for (int iy = -1; iy <= 1; iy++) {
      vec2  nc      = cell + vec2(float(ix), float(iy)) + faceOffset;
      float h1      = fract(sin(dot(nc, vec2(127.1, 311.7))) * 43758.5453);
      float h2      = fract(sin(dot(nc, vec2(269.5, 183.3))) * 43758.5453);
      float h3      = fract(sin(dot(nc, vec2(419.2, 371.9))) * 43758.5453);
      float hasStar = step(h1, 0.05);   // ~5 % of cells contain a star
      vec2  sp      = vec2(h2, h3);
      float dist    = length(fr - sp - vec2(float(ix), float(iy)));
      float brightness = exp(-dist * dist * 60.0)
                       * (0.4 + h1 * 12.0)
                       * hasStar;
      vec3  sc = h1 < 0.015 ? vec3(0.75, 0.88, 1.00)  // blue-white
               : h1 < 0.030 ? vec3(1.00, 0.80, 0.55)  // warm orange
               :               vec3(1.00, 1.00, 1.00);  // white
      col += sc * brightness;
    }
    }
    return clamp(col, 0.0, 3.0);
  }

  // ── Project a world-space direction to UV screen coordinates ────────────
  vec2 dirToUV(vec3 d) {
    float aspect = u_resolution.x / u_resolution.y;
    // Clamp dotF to 0.01 rather than branching on dotF ≤ 0.  The old branch
    // returned vUv for backward-facing rays, creating a visible seam/ring at
    // the dotF = 0 boundary (near the shadow edge for strongly deflected rays).
    float dotF = max(dot(d, u_cam_forward), 0.01);
    float pR = dot(d, u_cam_right)  / dotF;
    float pU = dot(d, u_cam_up_vec) / dotF;
    return clamp(vec2(pR / (u_fov_tan * aspect), pU / u_fov_tan) * 0.5 + 0.5, 0.001, 0.999);
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
    // E₀² = f(r_observer): conserved BL energy squared for a photon whose
    // local-frame energy p^(t̂) = 1.  Must be carried through the integration
    // so that H = 0 is satisfied (null geodesic, not massive-particle).
    float E2    = f0;

    // Escape radius scales with mass and outer disk edge so rays always reach
    // the background even for high-mass black holes.
    float escapeR = max(50.0, u_r_outer * u_mass * 3.0);

    // ── Decompose ray direction into local tetrad components ───────────────
    //
    // At static observer in Schwarzschild, the orthonormal tetrad coframe:
    //   ê_r̂ = (sinθ cosφ, cosθ, sinθ sinφ)   unit radial in Cartesian
    //   ê_θ̂ = (cosθ cosφ, −sinθ, cosθ sinφ)  unit polar  in Cartesian
    //   ê_φ̂ = (−sinφ,     0,     cosφ)        unit azimuthal in Cartesian
    //
    // Tetrad → BL momenta (E_BL = √f₀):
    //   p_r   = n_r̂ / √f₀
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
    float totalDphi = 0.0;   // accumulated |Δφ| — used to reject secondary images

    for (int i = 0; i < N_STEPS; i++) {

      // ── Detect disk plane crossing (cos θ changes sign → θ crosses π/2) ─
      float currCosT = cos(s.y);
      // Accept only the first disk crossing (primary image) that occurs before
      // the ray has traveled more than π radians in azimuth.  Crossings beyond
      // π are secondary/back-side images; they form the teardrop artefact at
      // the poles when the ray orbits the BH and crosses the disk from behind.
      if (abs(prevCosT) > 0.01 && prevCosT * currCosT < 0.0
          && diskHits < 1 && totalDphi < PI) {
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
      float dphiStep = Lz / (s.x * s.x * sinT2) * dl;
      totalDphi += abs(dphiStep);
      phi += dphiStep;

      // ── RK4 step for (r, θ, p_r, p_θ) ────────────────────────────────
      s = rk4Step(s, Lz, E2, dl);

      // ── Horizon — absorb the ray ─────────────────────────────────────────
      // Schwarzschild horizon = 2M; use u_mass directly so this scales with
      // any black hole mass.  (u_r_horizon is kept for API compatibility.)
      if (s.x < 2.0 * u_mass + 0.1) {
        // Absorbed by the horizon — pure black regardless of any disk
        // crossings along the way.  In backward ray-tracing, an absorbed ray
        // represents a photon path that originated inside the BH; no light
        // escapes, so the pixel contributes nothing.
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // ── Escape — sample the warped background ──────────────────────────
      if (s.x > escapeR) {
        float f_esc = 1.0 - 2.0 * u_mass / s.x;
        float sinTE = max(abs(sin(s.y)), 1e-4);
        float dphi  = Lz / (s.x * s.x * sinTE * sinTE);
        vec3 escDir = normalize(blVelToCartesian(
          s.x, s.y, phi,
          f_esc * s.z,          // dr/dλ  = f · p_r
          s.w / (s.x * s.x),   // dθ/dλ  = p_θ / r²
          dphi                  // dφ/dλ  = Lz / (r² sin²θ)
        ));
        vec3 bg = starField(escDir);
        gl_FragColor = vec4(bg + diskAccum, 1.0);
        return;
      }
    }

    // Max iterations: ray trapped near photon sphere.
    // Output only accumulated disk light — no artificial glow, which was
    // creating a visible brownish ring artefact along the vertical axis.
    gl_FragColor = vec4(diskAccum, 1.0);
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
  uniforms.u_r_horizon.value   = 2.0 * data.mass;
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
