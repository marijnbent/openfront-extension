import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const STAGE_DIR = path.join(DIST_DIR, 'unpacked');

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function readManifest() {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  if (!manifest.name || !manifest.version) {
    throw new Error('manifest.json must include both "name" and "version".');
  }

  return manifest;
}

async function ensureRequiredPaths() {
  const required = ['manifest.json', 'icons', 'popup', 'src'];

  await Promise.all(
    required.map(async (entry) => {
      const source = path.join(ROOT_DIR, entry);
      await readFile(source).catch(async (error) => {
        if (error.code === 'EISDIR') {
          return;
        }
        throw new Error(`Missing required path: ${source}`);
      });
    }),
  );
}

export async function buildExtension() {
  await ensureRequiredPaths();

  const manifest = await readManifest();
  const archiveName = `${slugify(manifest.name)}-v${manifest.version}.zip`;
  const archivePath = path.join(DIST_DIR, archiveName);

  await rm(STAGE_DIR, { recursive: true, force: true });
  await mkdir(STAGE_DIR, { recursive: true });

  await cp(path.join(ROOT_DIR, 'manifest.json'), path.join(STAGE_DIR, 'manifest.json'));
  await cp(path.join(ROOT_DIR, 'icons'), path.join(STAGE_DIR, 'icons'), { recursive: true });
  await cp(path.join(ROOT_DIR, 'popup'), path.join(STAGE_DIR, 'popup'), { recursive: true });
  await cp(path.join(ROOT_DIR, 'src'), path.join(STAGE_DIR, 'src'), { recursive: true });

  await rm(archivePath, { force: true });
  await execFileAsync('zip', ['-qrX', archivePath, '.'], { cwd: STAGE_DIR });

  return {
    archivePath,
    stageDir: STAGE_DIR,
    version: manifest.version,
    name: manifest.name
  };
}

async function main() {
  const result = await buildExtension();
  console.log(`Built unpacked extension at: ${result.stageDir}`);
  console.log(`Built release archive at: ${result.archivePath}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
