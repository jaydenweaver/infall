/* @ts-self-types="./infall_wasm.d.ts" */
import * as wasm from "./infall_wasm_bg.wasm";
import { __wbg_set_wasm } from "./infall_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    wasm_ergosphere_radius, wasm_event_horizon, wasm_init, wasm_isco_radius, wasm_step
} from "./infall_wasm_bg.js";
