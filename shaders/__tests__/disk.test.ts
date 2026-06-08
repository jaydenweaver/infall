import * as THREE from 'three';
import {
  DISK_VERT,
  DISK_FRAG,
  createDiskMaterial,
  updateDiskUniforms,
} from '../disk';

const defaults = { mass: 1.0, spin: 0.0, obs_r: 6.0, obs_phi: 0.0 };

describe('disk shader', () => {
  // ── createDiskMaterial ──────────────────────────────────────────────────

  it('returns a ShaderMaterial', () => {
    expect(createDiskMaterial(defaults)).toBeInstanceOf(THREE.ShaderMaterial);
  });

  it('sets all expected uniform keys', () => {
    const mat = createDiskMaterial(defaults);
    for (const key of [
      'u_mass', 'u_spin', 'u_r_inner', 'u_r_outer', 'u_world_scale',
      'u_obs_r', 'u_obs_phi',
    ]) {
      expect(mat.uniforms).toHaveProperty(key);
    }
  });

  it('initialises uniform values from data', () => {
    const mat = createDiskMaterial({ mass: 2.0, spin: 0.5, obs_r: 10.0, obs_phi: 1.2 });
    expect(mat.uniforms.u_mass.value).toBe(2.0);
    expect(mat.uniforms.u_spin.value).toBe(0.5);
    expect(mat.uniforms.u_obs_r.value).toBe(10.0);
    expect(mat.uniforms.u_obs_phi.value).toBeCloseTo(1.2);
  });

  it('uses AdditiveBlending', () => {
    expect(createDiskMaterial(defaults).blending).toBe(THREE.AdditiveBlending);
  });

  it('does not write to the depth buffer', () => {
    expect(createDiskMaterial(defaults).depthWrite).toBe(false);
  });

  it('renders both sides', () => {
    expect(createDiskMaterial(defaults).side).toBe(THREE.DoubleSide);
  });

  it('accepts custom geometry bounds', () => {
    const mat = createDiskMaterial(defaults, 3.0, 40.0, 200.0);
    expect(mat.uniforms.u_r_inner.value).toBe(3.0);
    expect(mat.uniforms.u_r_outer.value).toBe(40.0);
    expect(mat.uniforms.u_world_scale.value).toBe(200.0);
  });

  // ── updateDiskUniforms ──────────────────────────────────────────────────

  it('updateDiskUniforms mutates uniform values in place', () => {
    const mat = createDiskMaterial(defaults);
    updateDiskUniforms(mat, { mass: 3.0, spin: 0.9, obs_r: 4.5, obs_phi: 2.1 });
    expect(mat.uniforms.u_mass.value).toBe(3.0);
    expect(mat.uniforms.u_spin.value).toBe(0.9);
    expect(mat.uniforms.u_obs_r.value).toBe(4.5);
    expect(mat.uniforms.u_obs_phi.value).toBeCloseTo(2.1);
  });

  it('updateDiskUniforms leaves geometry uniforms unchanged', () => {
    const mat = createDiskMaterial(defaults, 2.1, 25.0, 100.0);
    updateDiskUniforms(mat, { mass: 2.0, spin: 0.0, obs_r: 5.0, obs_phi: 0.5 });
    expect(mat.uniforms.u_r_inner.value).toBe(2.1);
    expect(mat.uniforms.u_r_outer.value).toBe(25.0);
    expect(mat.uniforms.u_world_scale.value).toBe(100.0);
  });

  // ── Shader source sanity ────────────────────────────────────────────────

  it('vertex shader declares vWorldPos varying', () => {
    expect(DISK_VERT).toContain('vWorldPos');
  });

  it('fragment shader references all uniforms', () => {
    for (const name of [
      'u_mass', 'u_spin', 'u_r_inner', 'u_r_outer',
      'u_world_scale', 'u_obs_r', 'u_obs_phi',
    ]) {
      expect(DISK_FRAG).toContain(name);
    }
  });

  it('fragment shader implements temperature gradient', () => {
    expect(DISK_FRAG).toContain('temp');
    expect(DISK_FRAG).toContain('0.75'); // r^{-3/4} exponent
  });

  it('fragment shader implements Doppler beaming', () => {
    expect(DISK_FRAG).toContain('beta');
    expect(DISK_FRAG).toContain('gamma_');
    expect(DISK_FRAG).toContain('beam');
  });
});
