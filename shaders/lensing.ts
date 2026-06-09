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
  uniform float u_spin;     // dimensionless spin  a/M  ∈ [0, 1)

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

    // Page-Thorne inner boundary: emission → 0 exactly at the ISCO.
    // pow(rInner/r_M, 0.25) alone equals 1.0 at r=rInner (maximum!), which
    // creates a bright ISCO ring that lenses into the teardrop caustic.
    // Multiplying by (1 − √(rInner/r_M)) forces a physical zero at rInner
    // and peaks the brightness at ~2–3× rInner, matching the Page-Thorne model.
    float pageThorn = max(0.0, 1.0 - sqrt(rInner / r_M));
    float temp      = clamp(pow(rInner / r_M, 0.25), 0.0, 1.0) * pageThorn;
    vec3  col    = blackbodyColor(clamp(pow(rInner / r_M, 0.25), 0.0, 1.0));

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
  // Hamiltonian H = (1/2Σ)[Δp_r² + p_θ² − P²/Δ + (Lz−aEsin²θ)²/sin²θ] = 0
  //
  // Equations of motion:
  //   dr/dλ   = Δ/Σ · p_r
  //   dθ/dλ   = p_θ / Σ
  //   dp_r/dλ = −(r−M)/Σ · p_r² + 2rEP/(ΣΔ) − (r−M)P²/(ΣΔ²)
  //   dp_θ/dλ = cosθ · (Lz² − a²E²sin⁴θ) / (Σ sin³θ)
  //
  // dφ/dλ = [Lz(Δ−a²sin²θ)/(Δsin²θ) + 2aMrE/Δ] / Σ  (cyclic, integrated separately).
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
      Dl / Sig * pr,                                          // dr/dλ = Δ/Σ p_r
      pth / Sig,                                              // dθ/dλ = p_θ/Σ
      - rM / Sig * pr * pr                                    // dp_r/dλ
        + 2.0 * r * E * P / (Sig * Dl)
        - rM * P * P / (Sig * Dl * Dl),
      cosT * (Lz*Lz - a2*E2*sin2*sin2) / (Sig*sinT*sin2)    // dp_θ/dλ
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
    float sinT0 = sin(th0), cosT0 = cos(th0);
    float sinP0 = sin(phi0), cosP0 = cos(phi0);
    float a0    = u_spin * u_mass;
    float Sig0  = r0*r0 + a0*a0*cosT0*cosT0;   // Σ at observer
    float Dl0   = r0*r0 - 2.0*u_mass*r0 + a0*a0; // Δ at observer
    // E₀² = (Σ₀ − 2Mr₀)/Σ₀: conserved BL energy squared from the Kerr static
    // tetrad (p^(t̂) = 1).  Reduces to 1−2M/r₀ for Schwarzschild.
    float E2    = max((Sig0 - 2.0*u_mass*r0) / Sig0, 1e-6);

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

    vec3 e_r   = vec3(sinT0*cosP0,  cosT0,  sinT0*sinP0);
    vec3 e_th  = vec3(cosT0*cosP0, -sinT0,  cosT0*sinP0);
    vec3 e_phi = vec3(-sinP0,       0.0,    cosP0);

    float n_r   = dot(ray, e_r);
    float n_th  = dot(ray, e_th);
    float n_phi = dot(ray, e_phi);

    // Lz uses the Schwarzschild approximation (error O(a/r), acceptable for
    // moderate spin).  p_r and p_θ use the Kerr tetrad factors √(Σ₀/Δ₀) and √Σ₀.
    float Lz = n_phi * r0 * sinT0;
    vec4  s  = vec4(r0, th0,
                    n_r  * sqrt(max(Sig0 / max(Dl0, 1e-6), 0.0)),
                    n_th * sqrt(Sig0));
    float phi = phi0;

    // ── Main geodesic loop ─────────────────────────────────────────────────
    // Volumetric disk: accumulate emission from a Gaussian vertical density
    // profile at every step.  Kerr frame-dragging breaks axial symmetry and
    // physically eliminates the polar teardrop caustic.
    vec3  diskAccum = vec3(0.0);
    float diskAlpha = 0.0;
    float E         = sqrt(max(E2, 1e-6));  // conserved BL energy (constant)

    for (int i = 0; i < N_STEPS; i++) {

      // ── Adaptive step size: smaller near the horizon ───────────────────
      float dl = 0.5 * max(s.x / max(5.0 * u_mass, 1.0), 0.05);

      // ── Volumetric accretion disk ──────────────────────────────────────
      float rEq  = s.x * abs(sin(s.y));
      float zBL  = s.x * cos(s.y);
      float sig  = max(0.08 * rEq, 0.05 * u_mass);
      float dens = exp(-0.5 * (zBL / sig) * (zBL / sig));
      if (dens > 0.01 && rEq > u_r_inner * u_mass && rEq < u_r_outer * u_mass) {
        float trs  = 1.0 - diskAlpha;
        float wt   = dens * dl;
        diskAccum += diskColor(rEq, phi) * wt * trs;
        diskAlpha  = min(diskAlpha + wt * trs * 0.5, 0.99);
        if (diskAlpha > 0.98) break;
      }

      // ── Advance φ (Kerr: frame-dragging adds 2aMrE/Δ term) ────────────
      float a_ph    = u_spin * u_mass;
      float a2_ph   = a_ph * a_ph;
      float r2_ph   = s.x * s.x;
      float sinT_ph = max(abs(sin(s.y)), 1e-4);
      float sin2_ph = sinT_ph * sinT_ph;
      float Sig_ph  = r2_ph + a2_ph * (1.0 - sin2_ph);   // r²+a²cos²θ
      float Dl_ph   = max(r2_ph - 2.0*u_mass*s.x + a2_ph, 1e-6);
      // dφ/dλ = [Lz(Δ−a²sin²θ)/(Δsin²θ) + 2aMrE/Δ] / Σ
      phi += (Lz*(Dl_ph - a2_ph*sin2_ph)/(Dl_ph*sin2_ph)
              + 2.0*a_ph*u_mass*s.x*E/Dl_ph) / Sig_ph * dl;

      // ── RK4 step for (r, θ, p_r, p_θ) ────────────────────────────────
      s = rk4Step(s, Lz, E2, dl);

      // ── Horizon — absorb the ray ─────────────────────────────────────────
      // Kerr outer horizon r₊ = M + √(M²−a²).
      float rPlus = u_mass + sqrt(max(u_mass*u_mass*(1.0 - u_spin*u_spin), 0.0));
      if (s.x < rPlus + 0.1) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // ── Escape — sample the warped background ──────────────────────────
      if (s.x > escapeR) {
        // Kerr velocity: dr/dλ = Δ/Σ p_r,  dθ/dλ = p_θ/Σ,
        // dφ/dλ = [Lz(Δ-a²sin²θ)/(Δsin²θ) + 2aMrE/Δ] / Σ
        float a_e    = u_spin * u_mass;
        float a2_e   = a_e * a_e;
        float r2_e   = s.x * s.x;
        float sinTE  = max(abs(sin(s.y)), 1e-4);
        float sin2_e = sinTE * sinTE;
        float Sig_e  = r2_e + a2_e * (1.0 - sin2_e);
        float Dl_e   = max(r2_e - 2.0*u_mass*s.x + a2_e, 1e-6);
        vec3 escDir = normalize(blVelToCartesian(
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
    u_spin:        { value: data.spin },
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
  // Kerr horizon r₊ = M + √(M²−a²)
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
