/// <reference types="vite/client" />

/** Short git commit hash of the build, injected by Vite (see vite.config.ts). */
declare const __BUILD_ID__: string;

declare module "*.glb" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}
