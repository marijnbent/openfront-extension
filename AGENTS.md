# Project Instructions

## Scope
- Only modify files inside `/Users/marijn/Projects/openfront-extended`.
- Treat `reference/OpenFrontIO` as a read-only reference copy for behavior, assets, and feature parity checks.

## Change Rules
- Do not edit files in `reference/OpenFrontIO`.
- Prefer matching OpenFront behavior and terminology when porting or extending features in this extension.
- Avoid touching user-modified files unless the task requires it.

## Build And Release
- Use `npm run build` to produce a packaged extension zip under `dist/`.
- A release request means a GitHub release and a ZIP for manual Chrome Web Store upload.
- Keep the manifest version above the version already published in the Chrome Web Store. Use a supplied store version or screenshot when it is newer than the repository version.
- Use `npm run release:github -- patch` to bump the version, package the extension, create and push the release commit and tag, and publish a GitHub release.
- To include current uncommitted changes, use `npm run release:current -- patch --github-only`.
- Copy the resulting versioned ZIP from `dist/` to `/Users/marijn/Downloads/` and verify that the copy matches.
- Open `https://chrome.google.com/webstore/devconsole/cd974d6b-dc07-43b2-8f07-6a499aa32fd1/gbjflnkbijadpcdomkcmbohkpbkdcilf/edit/package` in the user's default browser so Marijn can upload and publish manually.
- Do not request Chrome Web Store API credentials or publish through its API unless explicitly asked.
- Override the release version with `npm run release:github -- minor`, `npm run release:github -- major`, or an explicit version such as `npm run release:github -- 1.0.1`.
