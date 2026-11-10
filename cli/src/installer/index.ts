// Public entry `upflare/installer`. The test fake lives in ./fake-api and is not exported here.
export { install, update, type UpdateOptions } from "./install";
export { pendingMigrations, type PendingMigration } from "./migrations";
export { generateEncryptionKey, generatePassword, validateAdminPassword, validateName } from "./secrets";
export * from "../contracts";
