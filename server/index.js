// Tiny bootstrap, deliberately kept free of any import that reads env vars at
// module-load time. ES module `import` statements are hoisted and evaluated
// before any other top-level code in the file runs — regardless of where they
// appear textually — so loading .env here and then statically importing
// app.js below it would NOT work (app.js's imports, and db.js's env check in
// particular, would already have run first). A dynamic import() is a real
// function call in normal execution order, so it happens after the env load.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

await import("./app.js");
