import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("build", { recursive: true });
await build({
  entryPoints: ["src/engine.ts"],
  bundle: true,
  outdir: "build",
  format: "esm",
  platform: "neutral",
  target: ["es2022"],
});
if (!process.argv.includes("--core-only")) {
  await mkdir("dist", { recursive: true });
  await build({
    entryPoints: ["web/app.js", "web/worker.js"],
    bundle: true,
    outdir: "dist",
    format: "esm",
    target: ["es2022"],
    legalComments: "external",
  });
  for (const file of ["index.html", "styles.css"])
    await copyFile(`web/${file}`, `dist/${file}`);
  await copyFile("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
  console.log("Built local-only browser assets in dist/.");
}
