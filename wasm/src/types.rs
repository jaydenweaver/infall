//! Shared data types for the simulation.
//!
//! `SimState` is the full mutable simulation state, held on the JS side and
//! passed back to WASM each tick (avoiding WASM-owned GC objects for simplicity).
//!
//! `FrameData` is the read-only output from each step, consumed by Three.js/shaders.

use serde::{Deserialize, Serialize};

/// Full simulation state. Serialised as a plain JS object.
///
/// Coordinates in Boyer-Lindquist (r, θ, φ).
/// All quantities in geometrized units (G = c = M = 1 by default).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SimState {
    // --- Black hole parameters ---
    /// Black hole mass (geometrized).
    pub mass: f64,
    /// Spin parameter a ∈ [0, M).
    pub spin: f64,

    // --- Observer position and velocity ---
    /// Radial coordinate.
    pub r: f64,
    /// Polar angle θ (radians). π/2 = equatorial plane.
    pub theta: f64,
    /// Azimuthal angle φ (radians).
    pub phi: f64,
    /// dr/dτ — radial component of 4-velocity.
    pub r_dot: f64,
    /// dθ/dτ — polar component of 4-velocity.
    pub theta_dot: f64,

    // --- Proper time ---
    /// Proper time elapsed since simulation start (affine parameter τ).
    pub proper_time: f64,

    // --- Conserved quantities (held constant during integration) ---
    /// Specific energy E = -p_t.
    pub energy: f64,
    /// Specific axial angular momentum L_z = p_φ.
    pub lz: f64,
    /// Carter constant Q.
    pub carter: f64,

    // --- Integration control ---
    /// Time warp multiplier (1.0 = real proper time, >1 = faster).
    pub time_warp: f64,
    /// True once the observer has crossed the event horizon or escaped.
    pub terminated: bool,
}

/// Per-frame output sent to the renderer each tick.
///
/// The Three.js side consumes this to:
///  - Update camera position / orientation
///  - Pass uniforms to the GLSL lensing shader
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FrameData {
    // --- Observer position ---
    pub r: f64,
    pub theta: f64,
    pub phi: f64,
    pub proper_time: f64,

    // --- Relativistic effects for shader ---
    /// Doppler factor D (isotropic approximation). Modulates disk emission.
    pub doppler_factor: f64,

    // --- Local orthonormal tetrad basis vectors ---
    // Each is a 3-vector [dr, dθ, dφ] in BL coordinates, normalised.
    // The shader uses these to orient the camera and compute aberration.
    pub tetrad_r: [f64; 3],
    pub tetrad_theta: [f64; 3],
    pub tetrad_phi: [f64; 3],

    /// Whether the simulation has ended (horizon crossing or escape).
    pub terminated: bool,
}
