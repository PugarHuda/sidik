import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// ponytail: load engine/.env into process.env so the RPC-gated integration
// suites pick up BASE_ARCHIVE_RPC without a shell export. Node 24 built-in,
// no dotenv dependency. Deployed runs inject env directly and have no .env.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    // Each integration file spawns its own anvil, and every fork replays a
    // burst of archive reads upstream. Run four of those at once and the RPC
    // answers 429, so the suite fails on quota rather than on the code. The
    // unit tests are milliseconds; serialising them costs nothing.
    fileParallelism: false,
  },
});
