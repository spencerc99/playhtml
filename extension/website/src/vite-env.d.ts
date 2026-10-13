/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
  readonly VITE_CATALOG_WORKER_URL?: string;
  readonly VITE_PAGE_INSPECTION_URL?: string;
  readonly VITE_COMMUTE_REVIEW_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
