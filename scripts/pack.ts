import * as Fs from "node:fs"
import * as Path from "node:path"

const packageJson = JSON.parse(Fs.readFileSync("package.json", "utf8"))

// Create dist-ready package.json
const distPackage = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  type: "module",
  license: packageJson.license,
  author: packageJson.author,
  repository: packageJson.repository,
  bugs: packageJson.bugs,
  homepage: packageJson.homepage,
  keywords: packageJson.keywords,
  main: packageJson.main,
  module: packageJson.module,
  types: packageJson.types,
  exports: packageJson.exports,
  bin: packageJson.bin,
  peerDependencies: packageJson.peerDependencies,
  dependencies: packageJson.dependencies,
  engines: packageJson.engines
}

Fs.mkdirSync("dist", { recursive: true })
Fs.writeFileSync(
  Path.join("dist", "package.json"),
  JSON.stringify(distPackage, null, 2) + "\n"
)

console.log("Created dist/package.json")
