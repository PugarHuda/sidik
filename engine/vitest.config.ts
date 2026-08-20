import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// ponytail: load engine/.env into process.env so the RPC-gated integration
// suites pick up BASE_ARCHIVE_RPC without a shell export. Node 24 built-in,
// no dotenv dependency. Deployed runs inject env directly and have no .env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({});
