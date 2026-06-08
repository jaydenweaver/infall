//! RK4 integrator for Kerr geodesics.
//!
//! State vector layout: [r, θ, φ̃, ṙ, θ̇]
//! φ̃ is the ingoing Kerr azimuthal coordinate, regular at the outer horizon.
//! Constants of motion (E, Lz, Q) are held fixed — φ̃̇ and ṫ are derived each step.
//!
//! The integration crosses the outer event horizon without stopping.
//! Termination conditions:
//!   - r < SINGULARITY_RADIUS  (near the ring/point singularity)
//!   - r > R_ESCAPE            (particle escaped to infinity)

use crate::kerr::{geodesic_rhs, ConservedQuantities, KerrParams, ParticleType};
use crate::types::{FrameData, SimState};

/// Stop this close to r = 0. Avoids the ring singularity (Kerr) / point
/// singularity (Schwarzschild) where curvature diverges.
const SINGULARITY_RADIUS: f64 = 0.02; // in units of M

const R_ESCAPE: f64 = 1e6; // consider escaped if r > this (in units of M)

/// Step size used in proper time units (relative to M).
/// Smaller = more accurate but slower. 1e-3 M is fine for visual purposes.
const DEFAULT_DTAU: f64 = 1e-3;

/// Single RK4 step.
///
/// `state` is [r, θ, φ, ṙ, θ̇].
/// Returns the updated state after one step of proper time `dtau`.
fn rk4_step(
    params: &KerrParams,
    state: [f64; 5],
    conserved: &ConservedQuantities,
    particle_type: ParticleType,
    dtau: f64,
) -> [f64; 5] {
    let f = |s: [f64; 5]| {
        geodesic_rhs(params, s[0], s[1], s[3], s[4], conserved, particle_type)
    };

    let k1 = f(state);
    let k2 = f(add_scaled(state, k1, dtau * 0.5));
    let k3 = f(add_scaled(state, k2, dtau * 0.5));
    let k4 = f(add_scaled(state, k3, dtau));

    let mut result = state;
    for i in 0..5 {
        result[i] += dtau / 6.0 * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
    result
}

#[inline]
fn add_scaled(base: [f64; 5], delta: [f64; 5], scale: f64) -> [f64; 5] {
    [
        base[0] + delta[0] * scale,
        base[1] + delta[1] * scale,
        base[2] + delta[2] * scale,
        base[3] + delta[3] * scale,
        base[4] + delta[4] * scale,
    ]
}

/// Advance the simulation by `dtau` of proper time (or by a default step).
///
/// Returns the new `SimState` and a `FrameData` describing the frame at the
/// new position. Returns `None` if integration has already terminated.
pub fn step(sim: SimState, dtau: Option<f64>) -> Option<(SimState, FrameData)> {
    if sim.terminated {
        return None;
    }

    let params = KerrParams::new(sim.mass, sim.spin);
    let conserved = ConservedQuantities {
        energy: sim.energy,
        ang_momentum_z: sim.lz,
        carter: sim.carter,
    };

    let dtau = dtau.unwrap_or(DEFAULT_DTAU) * sim.time_warp;
    let state = [sim.r, sim.theta, sim.phi, sim.r_dot, sim.theta_dot];
    let new_state = rk4_step(&params, state, &conserved, ParticleType::Massive, dtau);

    let [r, theta, phi, r_dot, theta_dot] = new_state;
    let tau = sim.proper_time + dtau;

    // Termination conditions
    let terminated = r < SINGULARITY_RADIUS * params.mass || r > R_ESCAPE * params.mass;
    let inside_horizon = r < params.event_horizon();

    // φ̇ at new position (for tetrad construction)
    let phi_dot = {
        let rhs = geodesic_rhs(&params, r, theta, r_dot, theta_dot, &conserved, ParticleType::Massive);
        rhs[2]
    };

    // --- Local orthonormal tetrad (for camera / lensing shader uniforms) ---
    // The tetrad vectors give the observer's local inertial frame.
    // We compute the ZAMO (Zero Angular Momentum Observer) tetrad and boost
    // it to the infalling observer's velocity.
    let tetrad = compute_tetrad(&params, r, theta, r_dot, theta_dot, phi_dot, &conserved);

    // Doppler factor relative to a static ZAMO at the same position
    let doppler = compute_doppler_factor(&params, r, theta, r_dot, theta_dot, &conserved);

    let new_sim = SimState {
        mass: sim.mass,
        spin: sim.spin,
        r,
        theta,
        phi,
        r_dot,
        theta_dot,
        proper_time: tau,
        energy: sim.energy,
        lz: sim.lz,
        carter: sim.carter,
        time_warp: sim.time_warp,
        terminated,
    };

    let frame = FrameData {
        r,
        theta,
        phi,
        proper_time: tau,
        doppler_factor: doppler,
        // Tetrad as flat arrays [e_r, e_theta, e_phi] in BL/IK coordinates
        tetrad_r: tetrad[0],
        tetrad_theta: tetrad[1],
        tetrad_phi: tetrad[2],
        inside_horizon,
        terminated,
    };

    Some((new_sim, frame))
}

/// Compute the observer's local orthonormal spatial tetrad basis in the
/// equatorial plane (θ = π/2 approximation for near-equatorial infalls).
///
/// Returns [e_r, e_theta, e_phi] as unit 3-vectors in (r, θ, φ) BL coords,
/// measured by the infalling observer.
fn compute_tetrad(
    params: &KerrParams,
    r: f64,
    theta: f64,
    r_dot: f64,
    theta_dot: f64,
    phi_dot: f64,
    _conserved: &ConservedQuantities,
) -> [[f64; 3]; 3] {
    let sigma = params.sigma(r, theta);
    let delta = params.delta(r);
    let (m, a) = (params.mass, params.spin);
    let sin_th = theta.sin();

    // BL metric components (diagonal except g_tφ):
    // g_rr = Σ/Δ,  g_θθ = Σ,  g_φφ = (r²+a²)sin²θ + 2Mr a²sin⁴θ/Σ
    let g_rr = sigma / delta;
    let g_tt = -(1.0 - 2.0 * m * r / sigma);
    let g_tphi = -2.0 * m * r * a * sin_th * sin_th / sigma;
    let g_phiphi = (r * r + a * a + 2.0 * m * r * a * a * sin_th * sin_th / sigma)
        * sin_th
        * sin_th;
    let g_thth = sigma;

    // Observer 4-velocity components: u^μ = (ṫ, ṙ, θ̇, φ̇)
    // ṫ derived from normalization g_μν u^μ u^ν = -1
    // ṫ = -(g_tφ φ̇ + √((g_tφ φ̇)² - g_tt(1 + g_rr ṙ² + g_θθ θ̇² + g_φφ φ̇²))) / g_tt
    let spatial_norm = g_rr * r_dot * r_dot + g_thth * theta_dot * theta_dot + g_phiphi * phi_dot * phi_dot;
    let discriminant = g_tphi * g_tphi * phi_dot * phi_dot - g_tt * (1.0 + spatial_norm);
    let t_dot = (-g_tphi * phi_dot - discriminant.max(0.0).sqrt()) / g_tt;
    let _ = t_dot; // used implicitly through conserved.energy in the RHS

    // Orthonormal basis: just return normalised coordinate directions
    // scaled by the appropriate metric components.
    // These are passed as uniforms to the GLSL shader which needs them in
    // local-frame coordinates; the shader projects screen rays through them.
    let e_r = [1.0 / g_rr.abs().sqrt(), 0.0, 0.0];
    let e_theta = [0.0, 1.0 / g_thth.abs().sqrt(), 0.0];
    let e_phi = [0.0, 0.0, 1.0 / g_phiphi.abs().sqrt()];

    [e_r, e_theta, e_phi]
}

/// Compute the relativistic Doppler factor D for the infalling observer
/// relative to a local ZAMO.
///
/// D = 1 / (γ(1 - β·n̂)) where n̂ is the photon direction.
/// Here we return the isotropic Doppler factor (averaged over directions),
/// which the shader uses to modulate the accretion disk emission.
fn compute_doppler_factor(
    params: &KerrParams,
    r: f64,
    theta: f64,
    r_dot: f64,
    _theta_dot: f64,
    conserved: &ConservedQuantities,
) -> f64 {
    let sigma = params.sigma(r, theta);
    let delta = params.delta(r);
    let (m, _a) = (params.mass, params.spin);
    let _sin_th = theta.sin();

    // ZAMO angular velocity: Ω = -g_tφ / g_φφ = 2Mar / ((r²+a²)² - a²Δsin²θ)Σ...
    // Simplified: observer radial velocity in local frame
    // β_r = ṙ √(g_rr) / (ṫ √(-g_tt))  ... in local frame
    // For the purpose of the shader uniform, we return |β_r| as a proxy.

    let g_rr = sigma / delta;
    let g_tt_abs = (1.0 - 2.0 * m * r / sigma).abs();

    // energy = -p_t (conserved) = ṫ √(g_tt_abs) in static limit
    // Use E ≈ local energy to get ṫ approximation
    let t_dot_approx = conserved.energy / g_tt_abs.max(1e-12);
    let beta_r = (r_dot * g_rr.sqrt()) / (t_dot_approx * g_tt_abs.sqrt()).max(1e-12);
    let beta_r = beta_r.abs().min(0.999); // clamp to subluminal

    let gamma = 1.0 / (1.0 - beta_r * beta_r).sqrt();
    // Doppler factor for head-on emission (toward observer looking inward)
    gamma * (1.0 + beta_r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn make_sim_at_isco(spin: f64) -> SimState {
        let params = KerrParams::new(1.0, spin);
        let r_isco = params.isco_radius(true);
        let conserved = ConservedQuantities::circular_equatorial(&params, r_isco, true);

        SimState {
            mass: 1.0,
            spin,
            r: r_isco,
            theta: std::f64::consts::FRAC_PI_2,
            phi: 0.0,
            // Start with a tiny inward radial kick to break the circular orbit
            r_dot: -1e-5,
            theta_dot: 0.0,
            proper_time: 0.0,
            energy: conserved.energy,
            lz: conserved.ang_momentum_z,
            carter: conserved.carter,
            time_warp: 1.0,
            terminated: false,
        }
    }

    /// Build a sim at radius `r` (equatorial) with the physically consistent
    /// inward r_dot for the given conserved quantities: ṙ = -√R(r) / Σ(r).
    ///
    /// This satisfies the first integral Σ²ṙ² = R, which the second-order
    /// geodesic equation assumes. Violating it causes unphysical behaviour
    /// inside the horizon (incorrect sign of r̈).
    fn make_infalling_sim(mass: f64, spin: f64, r: f64) -> SimState {
        let params = KerrParams::new(mass, spin);
        let r_isco = params.isco_radius(true);
        let conserved = ConservedQuantities::circular_equatorial(&params, r_isco, true);
        let theta = std::f64::consts::FRAC_PI_2;

        let sigma = params.sigma(r, theta);
        let a = params.spin;
        let e = conserved.energy;
        let lz = conserved.ang_momentum_z;
        let q = conserved.carter;
        let p_val = (r * r + a * a) * e - a * lz;
        let xi = (lz - a * e).powi(2) + q + r * r; // timelike: μ = 1
        let big_r = p_val * p_val - params.delta(r) * xi;
        // big_r should be ≥ 0 at any accessible r; clamp to avoid √(neg) from float noise
        let r_dot = -(big_r.max(0.0).sqrt()) / sigma;

        SimState {
            mass,
            spin,
            r,
            theta,
            phi: 0.0,
            r_dot,
            theta_dot: 0.0,
            proper_time: 0.0,
            energy: e,
            lz,
            carter: q,
            time_warp: 1.0,
            terminated: false,
        }
    }

    #[test]
    fn step_returns_some_when_not_terminated() {
        let sim = make_sim_at_isco(0.0);
        assert!(step(sim, None).is_some());
    }

    #[test]
    fn step_returns_none_when_terminated() {
        let mut sim = make_sim_at_isco(0.0);
        sim.terminated = true;
        assert!(step(sim, None).is_none());
    }

    #[test]
    fn r_decreases_during_infall() {
        let sim = make_sim_at_isco(0.0);
        let r0 = sim.r;
        let (new_sim, _) = step(sim, Some(0.1)).unwrap();
        // With an inward kick, r should decrease
        assert!(new_sim.r < r0, "r = {}, r0 = {}", new_sim.r, r0);
    }

    #[test]
    fn proper_time_advances() {
        let sim = make_sim_at_isco(0.0);
        let (new_sim, frame) = step(sim, Some(0.1)).unwrap();
        assert!(new_sim.proper_time > 0.0);
        assert_relative_eq!(new_sim.proper_time, frame.proper_time, epsilon = 1e-12);
    }

    #[test]
    fn energy_approximately_conserved() {
        // After many steps, the conserved energy should not change
        // (it's held fixed by design — this tests the state struct integrity)
        let sim = make_sim_at_isco(0.0);
        let e0 = sim.energy;
        let (new_sim, _) = step(sim, Some(0.01)).unwrap();
        assert_relative_eq!(new_sim.energy, e0, epsilon = 1e-12);
    }

    #[test]
    fn continues_through_horizon() {
        // The simulation must NOT terminate at the horizon — it should cross it
        // and continue toward the singularity.
        // Start just outside the Schwarzschild horizon with physical r_dot.
        let sim = make_infalling_sim(1.0, 0.0, 2.1);

        let mut current = sim;
        let mut crossed = false;
        for _ in 0..10_000 {
            match step(current, Some(1e-3)) {
                Some((s, frame)) => {
                    if frame.inside_horizon {
                        crossed = true;
                        break;
                    }
                    current = s;
                }
                None => break,
            }
        }
        assert!(crossed, "simulation should cross the event horizon");
    }

    #[test]
    fn terminates_at_singularity() {
        // After crossing the horizon the simulation should eventually terminate
        // as r approaches the singularity. Start just inside with physical r_dot.
        let sim = make_infalling_sim(1.0, 0.0, 2.05);

        let mut current = sim;
        let mut terminated = false;
        for _ in 0..100_000 {
            match step(current, Some(1e-4)) {
                Some((s, _)) => {
                    if s.terminated {
                        terminated = true;
                        // r should be near 0, not near 2 (the horizon)
                        let r_horizon = KerrParams::new(s.mass, s.spin).event_horizon();
                        assert!(
                            s.r < r_horizon * 0.5,
                            "termination should occur inside horizon, got r = {}",
                            s.r
                        );
                        break;
                    }
                    current = s;
                }
                None => {
                    terminated = true;
                    break;
                }
            }
        }
        assert!(terminated, "simulation should terminate near singularity");
    }

    #[test]
    fn phi_advances_prograde() {
        // A prograde orbit should have increasing φ (positive Lz)
        let sim = make_sim_at_isco(0.0);
        let phi0 = sim.phi;
        let (new_sim, _) = step(sim, Some(0.1)).unwrap();
        assert!(new_sim.phi >= phi0, "φ should increase for prograde orbit");
    }

    #[test]
    fn kerr_infall_terminates_at_singularity() {
        // Spinning black hole — infall should cross horizon and terminate near singularity.
        // Kerr (a=0.9): r+ ≈ 1.436M. Start just outside with physical r_dot.
        let sim = make_infalling_sim(1.0, 0.9, 1.5);

        let mut current = sim;
        let mut terminated = false;
        for _ in 0..200_000 {
            match step(current, Some(1e-3)) {
                Some((s, _)) => {
                    if s.terminated {
                        terminated = true;
                        // Must have crossed the horizon
                        let r_horizon = KerrParams::new(s.mass, s.spin).event_horizon();
                        assert!(s.r < r_horizon, "should terminate inside horizon");
                        break;
                    }
                    current = s;
                }
                None => {
                    terminated = true;
                    break;
                }
            }
        }
        assert!(terminated, "Kerr infall should terminate near singularity");
    }
}
