# Project Instructions

## Scope
- Only modify files inside `/Users/marijn/Projects/openfront-extended`.
- Treat `/Users/marijn/Clones/OpenFrontIO` as a read-only reference repo for behavior, assets, and feature parity checks.

## Change Rules
- Do not edit or stage changes in `/Users/marijn/Clones/OpenFrontIO`.
- Prefer matching OpenFront behavior and terminology when porting or extending features in this extension.
- Avoid touching user-modified files unless the task requires it.

## Build And Release
- Use `npm run build` or `make build` to produce a packaged extension zip under `dist/`.
- Use `npm run release -- patch` or `make release` to bump the version, package the extension, publish it to the Chrome Web Store, create a release commit and tag, push them, and publish a GitHub release.
- Validate first-time credentials with `npm run release:check` or `make release-check`.
- Override the release version with `make release BUMP=minor`, `make release BUMP=major`, or `make release VERSION=0.2.0`.
