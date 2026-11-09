export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  EDGEBEAT_INSTALL_SOURCE?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};
