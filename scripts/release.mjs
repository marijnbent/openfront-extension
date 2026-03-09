import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFile,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from './build.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'manifest.json');
const ENV_FILES = [
  path.join(ROOT_DIR, '.env.release.local'),
  path.join(ROOT_DIR, '.env.release')
];
const GITHUB_API_VERSION = '2022-11-28';

function printUsage() {
  console.log(`Usage:
  npm run release -- [patch|minor|major|X.Y.Z] [--draft] [--github-only|--chrome-only] [--include-current-changes]
  npm run release:check

Examples:
  npm run release -- patch
  npm run release -- minor
  npm run release -- 0.2.0
  npm run release -- patch --draft
  npm run release -- patch --include-current-changes
  npm run release:github -- patch`);
}

function parseArgs(argv) {
  const options = {
    draft: false,
    githubOnly: false,
    chromeOnly: false,
    includeCurrentChanges: false,
    checkConfig: false,
    target: 'patch'
  };

  for (const arg of argv) {
    if (arg === '--draft') {
      options.draft = true;
      continue;
    }

    if (arg === '--github-only') {
      options.githubOnly = true;
      continue;
    }

    if (arg === '--chrome-only') {
      options.chromeOnly = true;
      continue;
    }

    if (arg === '--check-config') {
      options.checkConfig = true;
      continue;
    }

    if (arg === '--include-current-changes') {
      options.includeCurrentChanges = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    options.target = arg;
  }

  if (options.githubOnly && options.chromeOnly) {
    throw new Error('Use either --github-only or --chrome-only, not both.');
  }

  return options;
}

function parseDotEnv(contents) {
  const values = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function loadReleaseEnv() {
  for (const envPath of ENV_FILES) {
    try {
      const contents = await readFile(envPath, 'utf8');
      const parsed = parseDotEnv(contents);
      for (const [key, value] of Object.entries(parsed)) {
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

async function updateManifestVersion(nextVersion) {
  const manifest = await readManifest();
  manifest.version = nextVersion;
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function bumpSemver(currentVersion, target) {
  if (/^\d+\.\d+\.\d+$/u.test(target)) {
    return target;
  }

  const parts = currentVersion.split('.').map((segment) => Number(segment));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  const [major, minor, patch] = parts;

  if (target === 'patch') {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (target === 'minor') {
    return `${major}.${minor + 1}.0`;
  }

  if (target === 'major') {
    return `${major + 1}.0.0`;
  }

  throw new Error(`Unsupported version bump: ${target}`);
}

async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: ROOT_DIR,
      ...options
    });
    return result.stdout?.trim() ?? '';
  } catch (error) {
    const stderr = error.stderr?.trim();
    const message = stderr || error.message;
    throw new Error(`${command} ${args.join(' ')} failed: ${message}`);
  }
}

async function ensureCleanWorktree() {
  const status = await runCommand('git', ['status', '--porcelain']);
  if (status) {
    throw new Error('Release requires a clean git worktree. Commit or stash current changes first.');
  }
}

async function listWorktreeChanges() {
  const status = await runCommand('git', ['status', '--porcelain']);
  return status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function ensureTagAbsent(tagName) {
  try {
    await execFileAsync('git', ['rev-parse', tagName], { cwd: ROOT_DIR });
    throw new Error(`Tag already exists locally: ${tagName}`);
  } catch (error) {
    if (error.message.startsWith('Tag already exists locally')) {
      throw error;
    }
  }

  try {
    await execFileAsync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tagName}`], {
      cwd: ROOT_DIR
    });
    throw new Error(`Tag already exists on origin: ${tagName}`);
  } catch (error) {
    if (error.message.startsWith('Tag already exists on origin')) {
      throw error;
    }
  }
}

async function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const remote = await runCommand('git', ['remote', 'get-url', 'origin']);
  const slug = remote.replace(/^git@github\.com:/u, '').replace(/^https:\/\/github\.com\//u, '').replace(/\.git$/u, '');

  if (!slug.includes('/')) {
    throw new Error('Could not derive GITHUB_REPOSITORY from git origin.');
  }

  return slug;
}

async function getCurrentBranch() {
  return runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

async function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  try {
    return await runCommand('gh', ['auth', 'token']);
  } catch {
    throw new Error('Missing GitHub auth. Set GITHUB_TOKEN or run `gh auth login`.');
  }
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...options.headers
    },
    body: options.body
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function createGitHubRelease({
  archivePath,
  draft,
  manifestName,
  repoSlug,
  tagName,
  token,
  targetCommitish
}) {
  const release = await githubRequest(`https://api.github.com/repos/${repoSlug}/releases`, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tag_name: tagName,
      target_commitish: targetCommitish,
      name: `${manifestName} ${tagName}`,
      draft,
      generate_release_notes: true
    })
  });

  const uploadUrl = release.upload_url.replace(/\{\?name,label\}$/u, '');
  const archiveBuffer = await readFile(archivePath);
  const assetName = path.basename(archivePath);
  const assetUrl = `${uploadUrl}?name=${encodeURIComponent(assetName)}&label=${encodeURIComponent(assetName)}`;

  await githubRequest(assetUrl, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(archiveBuffer.length)
    },
    body: archiveBuffer
  });

  return release.html_url;
}

function getChromeConfig() {
  return {
    publisherId: process.env.CWS_PUBLISHER_ID,
    extensionId: process.env.CWS_EXTENSION_ID,
    clientId: process.env.CWS_CLIENT_ID,
    clientSecret: process.env.CWS_CLIENT_SECRET,
    refreshToken: process.env.CWS_REFRESH_TOKEN
  };
}

function getMissingChromeConfig(config) {
  return Object.entries({
    CWS_PUBLISHER_ID: config.publisherId,
    CWS_EXTENSION_ID: config.extensionId,
    CWS_CLIENT_ID: config.clientId,
    CWS_CLIENT_SECRET: config.clientSecret,
    CWS_REFRESH_TOKEN: config.refreshToken
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

async function getChromeAccessToken(config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh Chrome Web Store access token: ${text}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Chrome Web Store token response did not include an access token.');
  }

  return data.access_token;
}

async function chromeRequest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers
    },
    body: options.body
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chrome Web Store API ${response.status}: ${body}`);
  }

  return response.json();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForChromeUpload(accessToken, config) {
  const statusUrl = `https://chromewebstore.googleapis.com/v2/publishers/${config.publisherId}/items/${config.extensionId}:fetchStatus`;

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const status = await chromeRequest(statusUrl, accessToken);
    const state = status.lastAsyncUploadState;

    if (!state || state === 'SUCCEEDED' || state === 'NOT_FOUND') {
      return status;
    }

    if (state === 'FAILED') {
      throw new Error(`Chrome Web Store upload failed: ${JSON.stringify(status)}`);
    }

    await sleep(3000);
  }

  throw new Error('Timed out waiting for Chrome Web Store upload processing.');
}

async function publishToChromeWebStore({ archivePath, config }) {
  const accessToken = await getChromeAccessToken(config);
  const archiveBuffer = await readFile(archivePath);
  const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/publishers/${config.publisherId}/items/${config.extensionId}:upload`;

  const uploadResult = await chromeRequest(uploadUrl, accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(archiveBuffer.length)
    },
    body: archiveBuffer
  });

  if (uploadResult.uploadState === 'FAILED') {
    throw new Error(`Chrome Web Store upload failed: ${JSON.stringify(uploadResult)}`);
  }

  if (uploadResult.uploadState === 'IN_PROGRESS') {
    await waitForChromeUpload(accessToken, config);
  }

  const publishUrl = `https://chromewebstore.googleapis.com/v2/publishers/${config.publisherId}/items/${config.extensionId}:publish`;
  const publishResult = await chromeRequest(publishUrl, accessToken, {
    method: 'POST'
  });

  return {
    uploadResult,
    publishResult
  };
}

async function validateConfig({ githubRequired, chromeRequired }) {
  const problems = [];

  if (githubRequired) {
    try {
      await getRepoSlug();
      await getGitHubToken();
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (chromeRequired) {
    const missing = getMissingChromeConfig(getChromeConfig());
    if (missing.length > 0) {
      problems.push(`Missing Chrome Web Store config: ${missing.join(', ')}`);
    }
  }

  return problems;
}

async function main() {
  await loadReleaseEnv();

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const githubRequired = !options.chromeOnly;
  const chromeRequired = !options.githubOnly;
  const configProblems = await validateConfig({ githubRequired, chromeRequired });

  if (options.checkConfig) {
    if (configProblems.length === 0) {
      console.log('Release configuration looks valid.');
      return;
    }

    for (const problem of configProblems) {
      console.error(problem);
    }
    process.exitCode = 1;
    return;
  }

  if (configProblems.length > 0) {
    throw new Error(configProblems.join('\n'));
  }

  const worktreeChanges = await listWorktreeChanges();
  if (worktreeChanges.length > 0 && !options.includeCurrentChanges) {
    throw new Error(
      'Release requires a clean git worktree. Commit or stash current changes first, or rerun with --include-current-changes.'
    );
  }

  const manifest = await readManifest();
  const nextVersion = bumpSemver(manifest.version, options.target);
  if (nextVersion === manifest.version) {
    throw new Error(`Next version matches current version: ${manifest.version}`);
  }

  const tagName = `v${nextVersion}`;
  await ensureTagAbsent(tagName);

  const manifestBackup = `${MANIFEST_PATH}.release-backup`;
  let keepManifestChanges = false;

  await copyFile(MANIFEST_PATH, manifestBackup);

  try {
    await updateManifestVersion(nextVersion);
    const buildResult = await buildExtension();

    if (!options.githubOnly) {
      console.log(`Publishing ${tagName} to the Chrome Web Store...`);
      await publishToChromeWebStore({
        archivePath: buildResult.archivePath,
        config: getChromeConfig()
      });
      console.log('Chrome Web Store submission created.');
    }

    if (!options.chromeOnly) {
      console.log(`Creating git release ${tagName}...`);
      const targetCommitish = await getCurrentBranch();
      const repoSlug = await getRepoSlug();
      const token = await getGitHubToken();

      if (options.includeCurrentChanges) {
        await runCommand('git', ['add', '-A']);
      } else {
        await runCommand('git', ['add', 'manifest.json']);
      }
      await runCommand('git', ['commit', '-m', `chore: release ${tagName}`]);
      keepManifestChanges = true;
      await runCommand('git', ['tag', tagName]);
      await runCommand('git', ['push', 'origin', 'HEAD']);
      await runCommand('git', ['push', 'origin', tagName]);

      const releaseUrl = await createGitHubRelease({
        archivePath: buildResult.archivePath,
        draft: options.draft,
        manifestName: manifest.name,
        repoSlug,
        tagName,
        targetCommitish,
        token
      });

      console.log(`GitHub release created: ${releaseUrl}`);
    }

    if (options.chromeOnly) {
      console.log(`Chrome Web Store release submitted for ${tagName}.`);
    }
  } finally {
    if (!keepManifestChanges) {
      await copyFile(manifestBackup, MANIFEST_PATH);
    }
    await rm(manifestBackup, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
