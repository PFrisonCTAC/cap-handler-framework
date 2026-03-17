# Publishing cap-handler-framework to npm

This guide explains how to publish a new version of `cap-handler-framework` to the npm registry.

---

## Prerequisites

- Node.js and npm installed
- An account on [npmjs.com](https://www.npmjs.com)
- You are **the owner** (or a team member) of the `cap-handler-framework` package on npm

---

## Step 1 — Log in to npm

```bash
npm login
```

You will be prompted for:
- Username
- Password
- Email address
- OTP (one-time password from your authenticator app, if 2FA is enabled)

After logging in, verify you are authenticated:

```bash
npm whoami
# → your-npm-username
```

> **Using an access token instead of interactive login:**
>
> 1. Go to [npmjs.com → Account → Access Tokens](https://www.npmjs.com/settings/~/tokens)
> 2. Click **Generate New Token → Classic Token**
> 3. Select **Automation** (bypasses OTP for CI/CD) or **Publish** (requires OTP)
> 4. Copy the token and add it to `~/.npmrc`:
>
>    ```bash
>    echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE" >> ~/.npmrc
>    ```
>
> 5. Verify: `npm whoami`

---

## Step 2 — Bump the version

Always bump the version before publishing. Follow [semver](https://semver.org):

| Change type | Command | Example |
|-------------|---------|---------|
| Bug fix | `npm version patch` | `1.1.1` → `1.1.2` |
| New feature (backward-compatible) | `npm version minor` | `1.1.1` → `1.2.0` |
| Breaking change | `npm version major` | `1.1.1` → `2.0.0` |

Or set an explicit version:

```bash
npm version 1.2.0 --no-git-tag-version
```

> `--no-git-tag-version` prevents `npm version` from automatically creating a git commit and tag.
> Remove this flag if you want automatic git tagging.

---

## Step 3 — Review what will be published

```bash
npm pack --dry-run
```

Confirm the output contains:
- ✅ `dist/` — compiled JavaScript + type definitions
- ✅ `cds-plugin.js` — the CDS plugin (auto-generation + file watcher)
- ✅ `README.md`
- ✅ `package.json`
- ❌ No `src/` — TypeScript source is NOT published (correct)
- ❌ No `docs/` — documentation is NOT published (correct)
- ❌ No `node_modules/` — dev dependencies are NOT published (correct)

---

## Step 4 — Publish

```bash
npm publish
```

`npm publish` automatically runs `prepublishOnly` first:
1. `npm run clean` — deletes `dist/`
2. `npm run build` — recompiles TypeScript → fresh `dist/`
3. Publishes to registry

If 2FA is enabled:

```bash
npm publish --otp=123456
```

---

## Step 5 — Verify the publication

```bash
npm view cap-handler-framework
```

Or visit: https://www.npmjs.com/package/cap-handler-framework

---

## Step 6 — Tag the release in git

```bash
git add package.json package-lock.json
git commit -m "chore: release v1.1.1"
git tag v1.1.1
git push && git push --tags
```

---

## Full workflow example (releasing 1.1.1 → 1.1.2)

```bash
# 1. Log in (if not already)
npm login

# 2. Bump version
npm version patch --no-git-tag-version

# 3. Preview what will be published
npm pack --dry-run

# 4. Publish
npm publish

# 5. Verify
npm view cap-handler-framework version

# 6. Tag in git
git add package.json package-lock.json
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
git push && git push --tags
```

---

## After publishing — update the consuming project

In the CAP project that uses this framework:

```bash
npm install cap-handler-framework@latest
# or pin a specific version:
npm install cap-handler-framework@1.1.1
```

---

## Switching the CAP project from local dev back to npm version

The consuming project's `package.json` currently has:

```json
"cap-handler-framework": "file:../cap-handler-framework"
```

After publishing, switch to the npm version:

```json
"cap-handler-framework": "^1.1.1"
```

Then run `npm install` in the consuming project.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Not logged in or expired token | Run `npm login` or refresh token |
| `403 Forbidden` | Not the package owner/team member | Check ownership on npmjs.com |
| `404 Not Found (PUT)` | First publish with expired token | Run `npm login` then `npm publish` |
| `You cannot publish over the previously published versions` | Version already exists | Bump version with `npm version patch` |
| OTP required | 2FA is enabled | Use `npm publish --otp=123456` |

---

## Package contents reference

The `files` field in `package.json` controls what gets published:

```json
"files": [
  "dist/",
  "cds-plugin.js",
  "README.md",
  "LICENSE"
]
```

The `prepublishOnly` script ensures a clean, fresh build every time:

```json
"prepublishOnly": "npm run clean && npm run build"
```

---

## Current version history

| Version | Notes |
|---------|-------|
| `1.1.1` | Docs cleanup, cds-plugin.js singleton fix, local dev guide |
| `1.1.0` | Draft lifecycle, bound/unbound actions/functions, auto-generation |
| `1.0.0` | Initial release |
