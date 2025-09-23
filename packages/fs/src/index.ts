import * as core from "@modern-tar/core";

/**
 * Contains all Web Stream-based APIs from `@modern-tar/core`.
 */
export const web = core;

export { type PackOptions, packTar } from "./pack";
export { type UnpackOptions, unpackTar } from "./unpack";
