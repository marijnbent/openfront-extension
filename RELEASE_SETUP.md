# Release Setup

## One-time GitHub setup

Use one of these:

1. Run `gh auth login`
2. Or put a personal access token in `GITHUB_TOKEN` inside `.env.release.local`

If you use a token, it needs repository write access for releases.

## One-time Chrome Web Store setup

If this extension has never been uploaded to the Chrome Web Store before, do the first item creation manually:

1. Create the extension listing in the Chrome Web Store Developer Dashboard.
2. Upload the first package manually.
3. Fill out the `Store listing` and `Privacy` tabs.
4. Publish it manually once if Google requires it.

After that, configure API access:

1. Enable 2-step verification on the Google account that owns the item.
2. In Google Cloud, enable the Chrome Web Store API.
3. Configure an OAuth consent screen.
4. Create an OAuth client of type `Web application`.
5. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
6. Open the OAuth Playground, enable `Use your own OAuth credentials`, and request the scope `https://www.googleapis.com/auth/chromewebstore`.
7. Copy the resulting `client ID`, `client secret`, and `refresh token` into `.env.release.local`.
8. Copy your `publisher ID` from the Chrome Web Store Developer Dashboard account page.
9. Copy your `extension ID` from the Chrome Web Store item.

## Local config

1. Copy `.env.release.example` to `.env.release.local`
2. Fill in the required values
3. Run `npm run release:check`

## Commands

- `npm run build`
- `npm run release -- patch`
- `npm run release -- minor`
- `npm run release -- major`
- `npm run release -- 0.2.0`
- `npm run release:github`
- `npm run release:chrome`

## Notes

- The release command requires a clean git worktree.
- Chrome Web Store uploads still go through review before users receive the update.
- If you change Chrome Web Store visibility manually in the dashboard, Google requires one manual publish with the new visibility before API publishing works again.

## Official references

- Chrome Web Store API guide: https://developer.chrome.com/docs/webstore/using-api
- Chrome Web Store upload endpoint: https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload
- GitHub releases API: https://docs.github.com/en/rest/releases
