//! Kerr metric quantities in Boyer-Lindquist coordinates.
//!
//! Uses geometrized units: G = c = 1.
//! Coordinates: (t, r, θ, φ) — signature (-, +, +, +).
//!
//! Kerr parameters:
//!   M — black hole mass
//!   a — spin parameter (0 ≤ a ≤ M); a = J/M where J is angular momentum
//!
//! Derived quantities:
//!   Σ = r² + a²cos²θ
//!   Δ = r² - 2Mr + a²
//!   r₊ = M + √(M² - a²)  — outer event horizon
//!   r_ISCO  — innermost stable circular orbit

/// Kerr black hole parameters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KerrParams {
    /// Black hole mass (geometrized units).
    pub mass: f64,
    /// Spin parameter: 0 (Schwarzschild) ≤ a ≤ M (extremal Kerr).
    pub spin: f64,
}

impl KerrParams {
    /// Construct new params, clamping spin to [0, mass].
    pub fn new(mass: f64, spin: f64) -> Self {
        assert!(mass > 0.0, "mass must be positive");
        let spin = spin.clamp(0.0, mass * (1.0 - 1e-10)); // avoid exactly extremal
        Self { mass, spin }
    }

    /// Σ = r² + a²cos²θ
    #[inline]
    pub fn sigma(&self, r: f64, theta: f64) -> f64 {
        let a = self.spin;
        r * r + a * a * theta.cos().powi(2)
    }

    /// Δ = r² - 2Mr + a²
    #[inline]
    pub fn delta(&self, r: f64) -> f64 {
        let (m, a) = (self.mass, self.spin);
        r * r - 2.0 * m * r + a * a
    }

    /// Outer event horizon radius: r₊ = M + √(M² - a²)
    pub fn event_horizon(&self) -> f64 {
        let (m, a) = (self.mass, self.spin);
        m + (m * m - a * a).sqrt()
    }

    /// Inner (Cauchy) horizon radius: r₋ = M - √(M² - a²)
    #[allow(dead_code)] // used by shader uniforms in Phase 3
    pub fn inner_horizon(&self) -> f64 {
        let (m, a) = (self.mass, self.spin);
        m - (m * m - a * a).sqrt()
    }

    /// Ergosphere radius at polar angle θ: r_erg = M + √(M² - a²cos²θ)
    pub fn ergosphere_radius(&self, theta: f64) -> f64 {
        let (m, a) = (self.mass, self.spin);
        m + (m * m - a * a * theta.cos().powi(2)).sqrt()
    }

    /// Innermost stable circular orbit (ISCO) radius.
    ///
    /// Uses the exact Bardeen (1972) formula.
    /// `prograde`: true for co-rotating orbit (same sense as black hole spin).
    pub fn isco_radius(&self, prograde: bool) -> f64 {
        let (m, a) = (self.mass, self.spin);

        if a == 0.0 {
            return 6.0 * m; // Schwarzschild ISCO
        }

        let a_star = a / m; // dimensionless spin, ∈ [0, 1)

        let z1 = 1.0
            + (1.0 - a_star * a_star).cbrt()
                * ((1.0 + a_star).cbrt() + (1.0 - a_star).cbrt());
        let z2 = (3.0 * a_star * a_star + z1 * z1).sqrt();

        let sign: f64 = if prograde { -1.0 } else { 1.0 };
        m * (3.0 + z2 + sign * ((3.0 - z1) * (3.0 + z1 + 2.0 * z2)).sqrt())
    }

    /// Photon sphere radius (unstable circular photon orbit).
    ///
    /// For equatorial prograde/retrograde photons in Kerr spacetime.
    /// Uses the exact formula: r_ph = 2M[1 + cos(2/3 · arccos(∓a/M))]
    ///   - prograde:   ∓ = −  → r_ph → M   as a → M
    ///   - retrograde: ∓ = +  → r_ph → 4M  as a → M
    ///   - Schwarzschild limit (a=0): r_ph = 3M for both
    #[allow(dead_code)] // used by shader uniforms in Phase 3
    pub fn photon_sphere_radius(&self, prograde: bool) -> f64 {
        let (m, a) = (self.mass, self.spin);
        // arg ∈ [-1, 1] since a/m ∈ [0, 1)
        let arg = if prograde { -(a / m) } else { a / m };
        2.0 * m * (1.0 + (2.0 * arg.acos() / 3.0).cos())
    }
}

/// Conserved quantities along a geodesic.
///
/// These are constants of motion derived from Kerr's two Killing vectors
/// (∂/∂t and ∂/∂φ) plus the Carter constant Q from the hidden symmetry.
#[derive(Debug, Clone, Copy)]
pub struct ConservedQuantities {
    /// Specific energy: E = -p_t / μ  (1 for a particle at rest at infinity)
    pub energy: f64,
    /// Specific axial angular momentum: L_z = p_φ / μ
    pub ang_momentum_z: f64,
    /// Carter constant: Q = p_θ² + cos²θ(a²(μ² - E²) + L_z²/sin²θ)
    pub carter: f64,
}

impl ConservedQuantities {
    /// Compute conserved quantities for a circular equatorial orbit at radius r.
    ///
    /// This gives the initial conditions for the infall simulation (starting
    /// at rest on the ISCO with prograde angular momentum).
    pub fn circular_equatorial(params: &KerrParams, r: f64, prograde: bool) -> Self {
        let (m, a) = (params.mass, params.spin);
        let sign: f64 = if prograde { 1.0 } else { -1.0 };

        // From Bardeen et al. (1972), eqs. for circular geodesics:
        let sqrt_m_r = (m / (r * r * r)).sqrt(); // √(M/r³)

        let energy = (1.0 - 2.0 * m / r + sign * a * sqrt_m_r)
            / (1.0 - 3.0 * m / r + sign * 2.0 * a * sqrt_m_r).sqrt();

        let lz = sign * r * r * (sqrt_m_r - sign * 2.0 * a * m / (r * r * r))
            / (1.0 - 3.0 * m / r + sign * 2.0 * a * sqrt_m_r).sqrt();

        // Equatorial orbit: θ = π/2, p_θ = 0, so Carter constant Q = 0
        // (true only for equatorial orbits)
        Self {
            energy,
            ang_momentum_z: lz,
            carter: 0.0,
        }
    }
}

/// The right-hand side of the geodesic equations in first-order form.
///
/// State vector: [r, θ, φ, ṙ, θ̇]  (t and φ are recovered from conserved quantities)
/// where dots denote derivatives with respect to affine parameter λ (= proper time τ for massive).
///
/// Returns [ṙ, θ̇, φ̇, r̈, θ̈] — the derivatives of the state vector.
pub fn geodesic_rhs(
    params: &KerrParams,
    r: f64,
    theta: f64,
    r_dot: f64,
    theta_dot: f64,
    conserved: &ConservedQuantities,
    particle_type: ParticleType,
) -> [f64; 5] {
    let (m, a) = (params.mass, params.spin);
    let (e, lz, q) = (conserved.energy, conserved.ang_momentum_z, conserved.carter);

    let mu_sq = match particle_type {
        ParticleType::Massive => 1.0,
        ParticleType::Null => 0.0,
    };

    let sigma = params.sigma(r, theta);
    let delta = params.delta(r);
    let sin_th = theta.sin();
    let cos_th = theta.cos();
    let sin2 = sin_th * sin_th;
    let cos2 = cos_th * cos_th;

    // --- φ̇ (from Kerr geodesic equations) ---
    // φ̇ = [-(aE - Lz/sin²θ) + a(Δ⁻¹)((r²+a²)E - aLz)] / Σ
    let phi_dot = {
        let term1 = -(a * e - lz / sin2.max(1e-14));
        let term2 = a * ((r * r + a * a) * e - a * lz) / delta;
        (term1 + term2) / sigma
    };

    // --- Effective potentials for r and θ motion (used only for derivatives below) ---
    // R(r) = [(r²+a²)E - aLz]² - Δ[μ²r² + (Lz - aE)² + Q]
    // Θ(θ) = Q - cos²θ[a²(μ² - E²) + Lz²/sin²θ]

    // Second-order radial equation:
    // Σ r̈ = -Γ^r terms = dR/dr / (2Σ) - (Σ̇ r_dot)  [Mino parameterisation]
    // We use the Mino time parameterisation: Σ dλ = dτ_Mino
    // which decouples r and θ motions cleanly.
    //
    // d(Σ²ṙ²)/dλ = 2Σ · ṙ · r̈ + 2Σ̇ṙ² = dR/dr
    // → Σ r̈ = (dR/dr) / (2Σ) - Σ̇ṙ  ... but we use Mino: simpler
    //
    // In Mino time (used here), the equations are:
    //   (dr/dλ)² = R(r)         → ṙ² = R/Σ²  in Boyer-Lindquist
    //   d²r/dλ² = dR/dr / 2    (Mino time)
    //   d²θ/dλ² = dΘ/dθ / 2   (Mino time)
    //
    // Note: we integrate in coordinate time using BL, so we need to be careful.
    // We use the form: Σ² (ṙ)² = R,  Σ² (θ̇)² = Θ  in affine parameter.
    // Second derivatives:
    //   2Σ² ṙ r̈ + 2Σ Σ̇ ṙ² = dR/dr ṙ
    //   → r̈ = dR/dr / (2Σ²) - Σ̇ ṙ² / Σ   ... (*)
    //
    // For cleaner integration we use the substitution u_r = ṙ*Σ, u_θ = θ̇*Σ
    // and integrate directly with the sign tracked from the physical trajectory.

    // dR/dr
    let d_r = {
        let p = (r * r + a * a) * e - a * lz;
        let xi = (lz - a * e).powi(2) + q + mu_sq * r * r;
        4.0 * r * e * p - (2.0 * r - 2.0 * m) * xi - 2.0 * mu_sq * r * delta
    };

    // dΘ/dθ
    let d_theta = {
        // Θ = Q - cos²θ(a²(μ²-E²) + Lz²/sin²θ)
        // dΘ/dθ = 2cosθ sinθ(a²(μ²-E²) + Lz²/sin²θ) - cos²θ · Lz²·(-2cosθ/sin³θ)
        let bracket = a * a * (mu_sq - e * e) + lz * lz / sin2.max(1e-14);
        let term1 = 2.0 * cos_th * sin_th * bracket;
        let term2 = cos2 * lz * lz * 2.0 * cos_th / (sin_th * sin2).max(1e-14);
        term1 + term2
    };

    // dΣ/dr = 2r,  dΣ/dθ = -2a²cosθ sinθ
    let sigma_dot = 2.0 * r * r_dot + (-2.0 * a * a * cos_th * sin_th) * theta_dot;

    // r̈ and θ̈ from (*) style equation but keeping Σ explicit:
    //   Σ² ṙ² = R   (BL affine parameter)
    //   Differentiating: 2Σ² ṙ r̈ = dR/dr ṙ - 2Σ Σ̇ ṙ²
    //   If ṙ ≠ 0: r̈ = dR/dr / (2Σ²) - Σ̇ ṙ / Σ
    let sigma_sq = sigma * sigma;
    let r_ddot = d_r / (2.0 * sigma_sq) - sigma_dot * r_dot / sigma;
    let theta_ddot = d_theta / (2.0 * sigma_sq) - sigma_dot * theta_dot / sigma;

    [r_dot, theta_dot, phi_dot, r_ddot, theta_ddot]
}

/// Whether the geodesic is timelike (massive particle) or null (photon).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Null used by per-pixel shader integrator in Phase 3
pub enum ParticleType {
    Massive,
    Null,
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn schwarzschild() -> KerrParams {
        KerrParams::new(1.0, 0.0)
    }

    fn extremal_kerr() -> KerrParams {
        KerrParams::new(1.0, 1.0 - 1e-10)
    }

    #[test]
    fn schwarzschild_event_horizon() {
        let p = schwarzschild();
        // Schwarzschild horizon at r = 2M
        assert_relative_eq!(p.event_horizon(), 2.0, epsilon = 1e-10);
    }

    #[test]
    fn schwarzschild_isco() {
        let p = schwarzschild();
        // ISCO at r = 6M for Schwarzschild
        assert_relative_eq!(p.isco_radius(true), 6.0, epsilon = 1e-10);
        assert_relative_eq!(p.isco_radius(false), 6.0, epsilon = 1e-10);
    }

    #[test]
    fn extremal_kerr_prograde_isco() {
        let p = extremal_kerr();
        // Prograde ISCO → r = M (= 1.0 here) for exactly extremal Kerr.
        // Our spin is clamped to M*(1-1e-10) to avoid the degenerate limit,
        // so the ISCO is ~M + 7e-4 M. Tolerance reflects the clamp offset.
        assert_relative_eq!(p.isco_radius(true), p.mass, epsilon = 1e-3);
    }

    #[test]
    fn extremal_kerr_retrograde_isco() {
        let p = extremal_kerr();
        // Retrograde ISCO → r = 9M for extremal Kerr
        assert_relative_eq!(p.isco_radius(false), 9.0 * p.mass, epsilon = 1e-4);
    }

    #[test]
    fn schwarzschild_photon_sphere() {
        // Photon sphere at r = 3M in Schwarzschild limit
        // Use a tiny spin and check limit
        let p = KerrParams::new(1.0, 1e-9);
        let r_ph_pro = p.photon_sphere_radius(true);
        let r_ph_ret = p.photon_sphere_radius(false);
        assert_relative_eq!(r_ph_pro, 3.0, epsilon = 1e-4);
        assert_relative_eq!(r_ph_ret, 3.0, epsilon = 1e-4);
    }

    #[test]
    fn sigma_delta_schwarzschild_equatorial() {
        let p = schwarzschild();
        let theta = std::f64::consts::FRAC_PI_2; // equatorial
        // Schwarzschild equatorial: Σ = r², Δ = r² - 2r
        let r = 10.0;
        assert_relative_eq!(p.sigma(r, theta), r * r, epsilon = 1e-12);
        assert_relative_eq!(p.delta(r), r * r - 2.0 * r, epsilon = 1e-12);
    }

    #[test]
    fn ergosphere_equals_horizon_at_poles() {
        let p = KerrParams::new(1.0, 0.5);
        // At θ = 0 (pole), ergosphere = event horizon
        assert_relative_eq!(
            p.ergosphere_radius(0.0),
            p.event_horizon(),
            epsilon = 1e-10
        );
    }

    #[test]
    fn circular_orbit_energy_physical() {
        // For a circular orbit at ISCO, energy should be < 1 (bound) and > 0
        let p = schwarzschild();
        let r_isco = p.isco_radius(true);
        let cons = ConservedQuantities::circular_equatorial(&p, r_isco, true);
        assert!(cons.energy > 0.0 && cons.energy < 1.0,
            "energy = {}", cons.energy);
    }

    #[test]
    fn schwarzschild_isco_energy() {
        // Schwarzschild ISCO binding energy: E = √(8/9) ≈ 0.9428
        let p = schwarzschild();
        let r_isco = p.isco_radius(true);
        let cons = ConservedQuantities::circular_equatorial(&p, r_isco, true);
        let expected = (8.0_f64 / 9.0).sqrt();
        assert_relative_eq!(cons.energy, expected, epsilon = 1e-6);
    }
}
