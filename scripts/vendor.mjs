import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vendorCore } from "@cleanroom-ai/core/scripts/vendor.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
vendorCore({ appDir, models: ["ocr", "faces", "pii"], libs: ["ort", "transformers"] });

const require = createRequire(import.meta.url);
let mediabunnyPkg = dirname(require.resolve("mediabunny"));
while (!existsSync(join(mediabunnyPkg, "package.json"))) {
  const parent = dirname(mediabunnyPkg);
  if (parent === mediabunnyPkg) throw new Error("Could not locate mediabunny package root");
  mediabunnyPkg = parent;
}
mkdirSync(join(appDir, "vendor"), { recursive: true });
mkdirSync(join(appDir, "licenses"), { recursive: true });
copyFileSync(join(mediabunnyPkg, "dist", "bundles", "mediabunny.min.mjs"), join(appDir, "vendor", "mediabunny.mjs"));
copyFileSync(join(mediabunnyPkg, "LICENSE"), join(appDir, "licenses", "mediabunny-MPL-2.0.txt"));
console.log("   vendor/mediabunny.mjs (mediabunny 1.58.0 browser ESM bundle)");
