import {
  blToCartesian,
  blRadius,
  cameraUp,
  randomStarPositions,
  WORLD_SCALE,
  PI_OVER_2,
} from '../coordinates';

const EPSILON = 1e-9;

describe('blToCartesian', () => {
  it('places equatorial observer on the XZ plane', () => {
    const [x, y, z] = blToCartesian(6, PI_OVER_2, 0);
    expect(y).toBeCloseTo(0, 10);
    expect(x).toBeCloseTo(6 * WORLD_SCALE, 8);
    expect(z).toBeCloseTo(0, 10);
  });

  it('places polar observer on +Y axis', () => {
    const [x, y, z] = blToCartesian(6, 0, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(6 * WORLD_SCALE, 8);
    expect(z).toBeCloseTo(0, 10);
  });

  it('origin maps to origin', () => {
    const [x, y, z] = blToCartesian(0, PI_OVER_2, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('preserves distance from origin: |vec| = r * WORLD_SCALE', () => {
    const r = 10;
    const [x, y, z] = blToCartesian(r, 1.2, 2.5);
    const dist = Math.sqrt(x * x + y * y + z * z);
    expect(dist).toBeCloseTo(r * WORLD_SCALE, 6);
  });

  it('phi = 0 gives z = 0 at equatorial', () => {
    const [, , z] = blToCartesian(5, PI_OVER_2, 0);
    expect(z).toBeCloseTo(0, 10);
  });

  it('phi = π/2 gives x ≈ 0 at equatorial', () => {
    const [x] = blToCartesian(5, PI_OVER_2, PI_OVER_2);
    expect(x).toBeCloseTo(0, 6);
  });

  it('applies WORLD_SCALE factor', () => {
    const [x] = blToCartesian(1, PI_OVER_2, 0);
    expect(x).toBeCloseTo(WORLD_SCALE, 8);
  });
});

describe('blRadius', () => {
  it('returns r * WORLD_SCALE', () => {
    expect(blRadius(6)).toBeCloseTo(6 * WORLD_SCALE, 10);
    expect(blRadius(0)).toBe(0);
  });
});

describe('cameraUp', () => {
  it('returns unit vector', () => {
    const [ux, uy, uz] = cameraUp(PI_OVER_2, 0);
    const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
    expect(len).toBeCloseTo(1, 10);
  });

  it('at equatorial phi=0 points toward north pole (0,1,0)', () => {
    const [ux, uy, uz] = cameraUp(PI_OVER_2, 0);
    expect(ux).toBeCloseTo(0, 8);
    expect(uy).toBeCloseTo(1, 8);
    expect(uz).toBeCloseTo(0, 8);
  });

  it('at north pole phi=0 points in the -X direction', () => {
    // θ=0: up = (-cos0·cos0, sin0, -cos0·sin0) = (-1, 0, 0)
    const [ux, uy, uz] = cameraUp(0, 0);
    expect(ux).toBeCloseTo(-1, 8);
    expect(uy).toBeCloseTo(0, 8);
    expect(uz).toBeCloseTo(0, 8);
  });

  it('is orthogonal to the look direction (toward origin)', () => {
    // Camera position at (r, θ, φ), look direction ≈ -position normalised
    const r = 6;
    const theta = 1.0;
    const phi = 0.8;
    const [px, py, pz] = blToCartesian(r, theta, phi);
    const [ux, uy, uz] = cameraUp(theta, phi);
    // dot(look, up) = dot(-pos/|pos|, up) ≈ 0
    const dot = (-px * ux - py * uy - pz * uz) / (r * WORLD_SCALE);
    expect(Math.abs(dot)).toBeLessThan(0.01);
  });
});

describe('randomStarPositions', () => {
  it('returns correct buffer length', () => {
    const buf = randomStarPositions(100, 1000);
    expect(buf.length).toBe(300);
  });

  it('all points lie on the sphere surface', () => {
    const R = 1000;
    const buf = randomStarPositions(50, R);
    for (let i = 0; i < 50; i++) {
      const x = buf[i * 3];
      const y = buf[i * 3 + 1];
      const z = buf[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeCloseTo(R, 4);
    }
  });

  it('produces different positions each call (not degenerate)', () => {
    const a = randomStarPositions(10, 1000);
    const b = randomStarPositions(10, 1000);
    // Highly unlikely to be identical
    let same = true;
    for (let i = 0; i < 30; i++) {
      if (Math.abs(a[i] - b[i]) > EPSILON) { same = false; break; }
    }
    expect(same).toBe(false);
  });
});
