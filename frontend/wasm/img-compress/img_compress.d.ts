/* tslint:disable */
/* eslint-disable */

export function compress_jpeg(input: Uint8Array, quality: number, max_width: number, max_height: number): Uint8Array;

export function compress_png(input: Uint8Array, max_width: number, max_height: number): Uint8Array;

export function compress_webp(input: Uint8Array, quality: number, max_width: number, max_height: number): Uint8Array;

export function image_info(input: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compress_jpeg: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly compress_png: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly compress_webp: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly image_info: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
