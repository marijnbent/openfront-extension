# Project Instructions

## Scope
- Only modify files inside `/Users/marijn/Projects/openfront-extended`.
- Treat `/Users/marijn/Clones/OpenFrontIO` as a read-only reference repo for behavior, assets, and feature parity checks.

## Change Rules
- Do not edit or stage changes in `/Users/marijn/Clones/OpenFrontIO`.
- Prefer matching OpenFront behavior and terminology when porting or extending features in this extension.
- Avoid touching user-modified files unless the task requires it.

## Build And Release
- Use `npm run build` to produce a packaged extension zip under `dist/`.
- Use `npm run release -- patch` to bump the version, package the extension, publish it to the Chrome Web Store, create a release commit and tag, push them, and publish a GitHub release.
- If the repo already contains the changes you want to ship, use `npm run release:current -- patch`.
- Validate first-time credentials with `npm run release:check`.
- Override the release version with `npm run release -- minor`, `npm run release -- major`, or `npm run release -- 0.2.0`.
