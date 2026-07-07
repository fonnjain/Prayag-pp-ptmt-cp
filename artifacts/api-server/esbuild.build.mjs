import * as esbuild from "esbuild";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const workspacePkgs = new Set(
  Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((k) => k.startsWith("@workspace/"))
);

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/index.js",
  plugins: [
    {
      name: "bundle-workspace-externalize-npm",
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          const bare = args.path.startsWith("@")
            ? args.path.split("/").slice(0, 2).join("/")
            : args.path.split("/")[0];
          if (!workspacePkgs.has(bare)) {
            return { path: args.path, external: true };
          }
          return null;
        });
      },
    },
  ],
});

console.log("Build complete → dist/index.js");
