/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When `"1"`, the frontend runs fully self-contained with no backend. */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
