import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();

async function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

async function readCargoPackageVersion(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  const content = await readFile(absolutePath, "utf8");
  const match = content.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);

  if (!match) {
    throw new Error(`Could not find [package].version in ${relativePath}`);
  }

  return match[1];
}

const packageJsonPath = "package.json";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const cargoTomlPath = "src-tauri/Cargo.toml";

const [packageJson, tauriConfig, cargoVersion] = await Promise.all([
  readJson(packageJsonPath),
  readJson(tauriConfigPath),
  readCargoPackageVersion(cargoTomlPath),
]);

const versions = [
  { source: packageJsonPath, value: packageJson.version },
  { source: tauriConfigPath, value: tauriConfig.version },
  { source: cargoTomlPath, value: cargoVersion },
];

const uniqueVersions = new Set(versions.map(({ value }) => value));
const errors = [];

if (uniqueVersions.size !== 1) {
  errors.push(
    "Version mismatch detected:\n" +
      versions.map(({ source, value }) => `  - ${source}: ${value}`).join("\n"),
  );
}

const canonicalVersion = versions[0].value;
const releaseTag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG;

if (releaseTag && releaseTag.startsWith("v")) {
  const expectedTag = `v${canonicalVersion}`;
  if (releaseTag !== expectedTag) {
    errors.push(
      `Tag mismatch detected:\n  - expected tag: ${expectedTag}\n  - actual tag:   ${releaseTag}`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log(`Version metadata is aligned at ${canonicalVersion}.`);
