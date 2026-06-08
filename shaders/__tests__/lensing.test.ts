import {
  LENS_VERT,
  LENS_FRAG,
  LENSING_SHADER,
  createLensingUniforms,
  updateLensingUniforms,
} from '../lensing';

const defaults = {
  mass:        1.0,
  cam_r:       6.0,
  cam_theta:   Math.PI / 2,
  cam_phi:     0.0,
  cam_right:   [1, 0, 0] as [number, number, number],
  cam_up_vec:  [0, 1, 0] as [number, number, number],
  cam_forward: [0, 0, -1] as [number, number, number],
  resolution:  [1920, 1080] as [number, number],
};

describe('lensing shader', () => {
  // ── LENSING_SHADER constant ──────────────────────────────────────────────

  it('LENSING_SHADER exposes vertexShader and fragmentShader', () => {
    expect(typeof LENSING_SHADER.vertexShader).toBe('string');
    expect(typeof LENSING_SHADER.fragmentShader).toBe('string');
  });

  // ── createLensingUniforms ────────────────────────────────────────────────

  it('returns an object with all expected uniform keys', () => {
    const u = createLensingUniforms(defaults);
    for (const key of [
      'tDiffuse', 'u_resolution', 'u_mass',
      'u_r_inner', 'u_r_outer', 'u_r_horizon',
      'u_cam_r', 'u_cam_theta', 'u_cam_phi',
      'u_cam_right', 'u_cam_up_vec', 'u_cam_forward',
      'u_fov_tan',
    ]) {
      expect(u).toHaveProperty(key);
    }
  });

  it('initialises tDiffuse to null (filled by ShaderPass)', () => {
    expect(createLensingUniforms(defaults).tDiffuse.value).toBeNull();
  });

  it('stores observer position from data', () => {
    const u = createLensingUniforms(defaults);
    expect(u.u_cam_r.value).toBe(6.0);
    expect(u.u_cam_theta.value).toBeCloseTo(Math.PI / 2);
    expect(u.u_cam_phi.value).toBe(0.0);
  });

  it('stores mass and horizon radius', () => {
    const u = createLensingUniforms(defaults, 2.1, 25.0, 2.0);
    expect(u.u_mass.value).toBe(1.0);
    expect(u.u_r_horizon.value).toBe(2.0);
    expect(u.u_r_inner.value).toBe(2.1);
    expect(u.u_r_outer.value).toBe(25.0);
  });

  it('accepts custom disk bounds', () => {
    const u = createLensingUniforms(defaults, 3.5, 30.0, 4.0);
    expect(u.u_r_inner.value).toBe(3.5);
    expect(u.u_r_outer.value).toBe(30.0);
    expect(u.u_r_horizon.value).toBe(4.0);
  });

  it('sets fov_tan to 1.0 for 90° FOV', () => {
    expect(createLensingUniforms(defaults).u_fov_tan.value).toBe(1.0);
  });

  it('stores resolution', () => {
    const u = createLensingUniforms(defaults);
    expect(u.u_resolution.value).toEqual([1920, 1080]);
  });

  // ── updateLensingUniforms ────────────────────────────────────────────────

  it('mutates observer uniforms in place', () => {
    const u = createLensingUniforms(defaults);
    updateLensingUniforms(u, {
      ...defaults,
      mass: 2.0,
      cam_r: 10.0,
      cam_theta: 1.2,
      cam_phi: 0.5,
    });
    expect(u.u_mass.value).toBe(2.0);
    expect(u.u_cam_r.value).toBe(10.0);
    expect(u.u_cam_theta.value).toBeCloseTo(1.2);
    expect(u.u_cam_phi.value).toBeCloseTo(0.5);
  });

  it('leaves geometry bounds unchanged after update', () => {
    const u = createLensingUniforms(defaults, 2.1, 25.0, 2.0);
    updateLensingUniforms(u, defaults);
    expect(u.u_r_inner.value).toBe(2.1);
    expect(u.u_r_outer.value).toBe(25.0);
    expect(u.u_r_horizon.value).toBe(2.0);
    expect(u.u_fov_tan.value).toBe(1.0);
  });

  it('updates camera basis vectors', () => {
    const u = createLensingUniforms(defaults);
    const newRight:   [number, number, number] = [0, 0, 1];
    const newUp:      [number, number, number] = [0, 1, 0];
    const newForward: [number, number, number] = [-1, 0, 0];
    updateLensingUniforms(u, { ...defaults, cam_right: newRight, cam_up_vec: newUp, cam_forward: newForward });
    expect(u.u_cam_right.value).toEqual(newRight);
    expect(u.u_cam_up_vec.value).toEqual(newUp);
    expect(u.u_cam_forward.value).toEqual(newForward);
  });

  // ── Vertex shader ────────────────────────────────────────────────────────

  it('vertex shader sets vUv varying', () => {
    expect(LENS_VERT).toContain('vUv');
  });

  it('vertex shader uses standard Three.js built-ins', () => {
    expect(LENS_VERT).toContain('projectionMatrix');
    expect(LENS_VERT).toContain('modelViewMatrix');
  });

  // ── Fragment shader — structure ──────────────────────────────────────────

  it('fragment shader declares all uniforms', () => {
    for (const name of [
      'tDiffuse', 'u_mass', 'u_r_inner', 'u_r_outer', 'u_r_horizon',
      'u_cam_r', 'u_cam_theta', 'u_cam_phi',
      'u_cam_right', 'u_cam_up_vec', 'u_cam_forward', 'u_fov_tan',
    ]) {
      expect(LENS_FRAG).toContain(name);
    }
  });

  it('fragment shader implements RK4 integration', () => {
    expect(LENS_FRAG).toContain('rk4Step');
    expect(LENS_FRAG).toContain('k1');
    expect(LENS_FRAG).toContain('k2');
    expect(LENS_FRAG).toContain('k3');
    expect(LENS_FRAG).toContain('k4');
  });

  it('fragment shader implements geodesic derivative', () => {
    expect(LENS_FRAG).toContain('geodesicDeriv');
    expect(LENS_FRAG).toContain('u_r_horizon');
  });

  it('fragment shader contains N_STEPS loop', () => {
    expect(LENS_FRAG).toContain('N_STEPS');
    expect(LENS_FRAG).toContain('N_STEPS = 150');
  });

  it('fragment shader handles horizon termination', () => {
    expect(LENS_FRAG).toContain('u_r_horizon');
  });

  it('fragment shader samples tDiffuse for escaped rays', () => {
    expect(LENS_FRAG).toContain('texture2D(tDiffuse');
  });

  it('fragment shader computes disk colour analytically', () => {
    expect(LENS_FRAG).toContain('diskColor');
    expect(LENS_FRAG).toContain('0.75');  // T ∝ r^{-3/4}
    expect(LENS_FRAG).toContain('beam');  // Doppler beaming
  });

  it('fragment shader converts BL velocity to Cartesian', () => {
    expect(LENS_FRAG).toContain('blVelToCartesian');
  });

  it('fragment shader projects escaped direction to UV', () => {
    expect(LENS_FRAG).toContain('dirToUV');
  });
});
