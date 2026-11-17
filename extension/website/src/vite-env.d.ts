/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
  readonly VITE_ASSETS_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_CATALOG_WORKER_URL?: string;
  readonly VITE_PAGE_INSPECTION_URL?: string;
  readonly VITE_COMMUTE_REVIEW_URL?: string;
  readonly VITE_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
