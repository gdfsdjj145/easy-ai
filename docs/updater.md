# Updater Release Flow

This project now uses the Tauri v2 updater with GitHub Releases.

## What Is Wired

- Runtime update endpoint:
  - `https://github.com/gdfsdjj145/easy-ai/releases/latest/download/latest.json`
- Signed updater artifacts:
  - enabled through `src-tauri/tauri.conf.json`
- Desktop UI:
  - `Settings -> 应用更新`
- CI release workflow:
  - `.github/workflows/release.yml`

## Key Material

- Public key used by the app:
  - `src-tauri/keys/updater.key.pub`
- Private signing key:
  - store it only in GitHub Secrets or another offline secret store

The repository should only contain the public key. The private key must never be committed.

## GitHub Secrets

Before pushing a release tag, add these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
  - the full contents of your private updater key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - optional if your private key has no password

If you need to generate a new keypair locally:

```sh
pnpm tauri signer generate --ci -w src-tauri/keys/updater.key
```

If you want a password-protected key instead:

```sh
pnpm tauri signer generate --ci -w src-tauri/keys/updater.key -p "your-password" -f
```

Then replace `src-tauri/keys/updater.key.pub` with the new public key and update the matching GitHub Secret values.

## Publish A Release

1. Update version fields:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Commit the release changes.
3. Push a version tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The GitHub Actions workflow will:

- build desktop bundles
- create updater artifacts
- sign them with the private key secret
- upload assets to the GitHub Release

Once the release is published, desktop clients can check `Settings -> 应用更新` and install the new version.
