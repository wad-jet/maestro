import {
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, basename } from "node:path";

const DEPS = {
  "better-sqlite3": "^11.5.0",
  "sqlite-vec": "^0.1.6",
  "@qdrant/js-client-rest": "^1.19.0",
  "pg": "^8.13.0",
  "@huggingface/transformers": "^3.0.0",
};

export function ensureModule({ moduleDir, srcDir, version }) {
  try {
    mkdirSync(moduleDir, { recursive: true });

    // ── read current version (package.json from previous provisioning) ──
    const pkgPath = join(moduleDir, "package.json");
    const current = existsSync(pkgPath)
      ? JSON.parse(readFileSync(pkgPath, "utf8"))
      : null;

    // ── sync code from srcDir ──
    const exclude = (name) =>
      name.endsWith(".test.js") || name === "node_modules" || name === "package.json";

    const syncCode = () => {
      // Clean moduleDir except node_modules
      for (const f of readdirSync(moduleDir)) {
        if (f !== "node_modules") {
          rmSync(join(moduleDir, f), { recursive: true, force: true });
        }
      }
      // Copy srcDir → moduleDir, excluding test files and node_modules
      cpSync(srcDir, moduleDir, {
        recursive: true,
        filter: (src) => {
          const name = basename(src);
          return !exclude(name);
        },
      });
    };

    if (!current || current.version !== version) {
      syncCode();
    }

    // ── write package.json (single-writer, after sync) ──
    const manifest = {
      name: "maestro-memory",
      type: "module",
      version,
      dependencies: DEPS,
      private: true,
    };
    writeFileSync(pkgPath, JSON.stringify(manifest, null, 2), "utf8");

    return true;
  } catch {
    return false;
  }
}
