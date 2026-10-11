const { resolve, relative, isAbsolute, join } = require("node:path");
const { existsSync, lstatSync } = require("node:fs");

function resolvePackageAppDirectory(args, workspace) {
  if (
    args.length !== 0 &&
    (args.length !== 2 || args[0] !== "--app-dir" || !args[1])
  )
    throw new Error("Usage: test:package [--app-dir <workspace/dist directory>]");
  const root = resolve(workspace);
  const dist = join(root, "dist");
  const directory = resolve(root, args[1] ?? "dist/win-unpacked");
  const withinDist = relative(dist, directory);
  if (
    !withinDist ||
    withinDist === ".." ||
    withinDist.startsWith("..\\") ||
    withinDist.startsWith("../") ||
    isAbsolute(withinDist)
  )
    throw new Error("Packaged smoke app directory must be inside workspace/dist");
  let ancestor = root;
  for (const part of ["dist", ...withinDist.split(/[\\/]/)]) {
    ancestor = join(ancestor, part);
    if (existsSync(ancestor)) {
      const entry = lstatSync(ancestor);
      if (entry.isSymbolicLink() || !entry.isDirectory())
        throw new Error("Packaged smoke path must use ordinary directories");
    }
  }
  return directory;
}

module.exports = { resolvePackageAppDirectory };
