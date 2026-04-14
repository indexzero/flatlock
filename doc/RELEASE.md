# Release Process

Releases are automated via [release-it](https://github.com/release-it/release-it) running in GitHub Actions. The workflow bumps `package.json`, updates `doc/CHANGELOG.md`, creates a bare semver git tag, and publishes to npm with OIDC provenance. The tag push triggers a separate workflow that builds ncc binaries for three platforms and creates the GitHub Release.

## Cutting a release

### From the CLI

```bash
gh workflow run release.yml --repo indexzero/flatlock -f increment=minor
```

Replace `minor` with `patch` or `major` as appropriate.

### From the GitHub UI

1. Go to **Actions > Release > Run workflow**
2. Select the increment type (patch, minor, or major)
3. Click **Run workflow**

## What happens

1. `release-it --ci --increment <type>` runs on `ubuntu-latest`
2. Determines the new version from the latest git tag + increment
3. Moves `[Unreleased]` content in `doc/CHANGELOG.md` into a versioned section
4. Bumps `version` in `package.json`
5. Commits `chore: release <version>`, tags with bare semver (e.g. `1.6.0`)
6. Publishes to npm (triggers `prepublishOnly` → `build:types` automatically)
7. Pushes commit and tag to `main`
8. Tag push triggers `ncc-release.yaml` which builds binaries (linux-x64, linux-arm64, darwin-arm64) and creates the GitHub Release with assets

## npm authentication

npm publishing uses [Trusted Publishers](https://docs.npmjs.com/trusted-publishers/) (OIDC) — the `Release` workflow in `indexzero/flatlock` is linked as a trusted publisher for the `flatlock` package. No `NPM_TOKEN` secret is needed.

## Changelog

The `@release-it/keep-a-changelog` plugin manages `doc/CHANGELOG.md`. When writing changes, add entries under the `## [Unreleased]` heading. The plugin converts this to a versioned heading at release time.

## Configuration

- `.release-it.json` — release-it config (tag format, changelog path, npm settings)
- `.github/workflows/release.yml` — release workflow (workflow_dispatch)
- `.github/workflows/ncc-release.yaml` — binary build workflow (tag-triggered)
