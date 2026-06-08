//! WASM entry point — exports the public API to JavaScript via wasm-bindgen.
//!
//! JS usage:
//! ```js
//! import init, { wasm_init, wasm_step } from './pkg/infall_wasm.js';
//!
//! await init();
//! let state = wasm_init(1.0, 0.9, null); // mass, spin, initial_r (null = ISCO)
//! const { state: newState, frame } = wasm_step(state, null); // null = default dtau
//! ```

mod geodesic;
mod kerr;
mod types;

use kerr::{ConservedQuantities, KerrParams};
use types::{FrameData, SimState};
use wasm_bindgen::prelude::*;

/// Initialise a new simulation state.
///
/// # Arguments
/// * `mass`      — Black hole mass (geometrized units, typically 1.0).
/// * `spin`      — Spin parameter a ∈ [0, mass). Values ≥ mass are clamped.
/// * `initial_r` — Starting radial coordinate. Pass `NaN` or `0` to start at the prograde ISCO.
///
/// # Returns
/// A `SimState` serialised as a JS object.
#[wasm_bindgen]
pub fn wasm_init(mass: f64, spin: f64, initial_r: f64) -> Result<JsValue, JsValue> {
    let params = KerrParams::new(mass, spin);

    let r0 = if initial_r.is_nan() || initial_r <= 0.0 {
        params.isco_radius(true)
    } else {
        initial_r
    };

    let conserved = ConservedQuantities::circular_equatorial(&params, r0, true);

    let state = SimState {
        mass,
        spin: params.spin, // clamped value
        r: r0,
        theta: std::f64::consts::FRAC_PI_2, // equatorial
        phi: 0.0,
        r_dot: -1e-5, // tiny inward kick to start infall from circular orbit
        theta_dot: 0.0,
        proper_time: 0.0,
        energy: conserved.energy,
        lz: conserved.ang_momentum_z,
        carter: conserved.carter,
        time_warp: 1.0,
        terminated: false,
    };

    serde_wasm_bindgen::to_value(&state).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Advance the simulation by one proper-time step.
///
/// # Arguments
/// * `state_js` — A `SimState` object previously returned by `wasm_init` or `wasm_step`.
/// * `dtau`     — Proper-time step size. Pass `NaN` or `0` for the default (1e-3 M).
///                Scaled by `state.time_warp`.
///
/// # Returns
/// A JS object `{ state: SimState, frame: FrameData }`, or `null` if terminated.
#[wasm_bindgen]
pub fn wasm_step(state_js: JsValue, dtau: f64) -> Result<JsValue, JsValue> {
    let sim: SimState = serde_wasm_bindgen::from_value(state_js)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let dtau_opt = if dtau.is_nan() || dtau <= 0.0 {
        None
    } else {
        Some(dtau)
    };

    match geodesic::step(sim, dtau_opt) {
        None => Ok(JsValue::NULL),
        Some((new_state, frame)) => {
            let result = StepResult {
                state: new_state,
                frame,
            };
            serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
        }
    }
}

/// Combined return type for `wasm_step`.
#[derive(serde::Serialize)]
struct StepResult {
    state: SimState,
    frame: FrameData,
}

/// Returns the outer event horizon radius for the given Kerr parameters.
#[wasm_bindgen]
pub fn wasm_event_horizon(mass: f64, spin: f64) -> f64 {
    KerrParams::new(mass, spin).event_horizon()
}

/// Returns the prograde ISCO radius for the given Kerr parameters.
#[wasm_bindgen]
pub fn wasm_isco_radius(mass: f64, spin: f64, prograde: bool) -> f64 {
    KerrParams::new(mass, spin).isco_radius(prograde)
}

/// Returns the ergosphere radius at a given polar angle θ (radians).
#[wasm_bindgen]
pub fn wasm_ergosphere_radius(mass: f64, spin: f64, theta: f64) -> f64 {
    KerrParams::new(mass, spin).ergosphere_radius(theta)
}
