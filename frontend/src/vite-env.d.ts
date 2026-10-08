/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'local' | 'cognito';
  readonly VITE_API_URL?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_USER_POOL_ID?: string;
  readonly VITE_USER_POOL_CLIENT_ID?: string;
  readonly VITE_MAPS_API_KEY?: string;
  readonly VITE_DEMO_PASSWORD?: string;
  readonly VITE_DEMO_EMAILS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
