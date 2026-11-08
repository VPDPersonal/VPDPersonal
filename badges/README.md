# Shared Aspid badges

The SVGs in this directory share the existing Aspid appearance, including light and dark system themes.
They are generated from published GitHub releases and the Unity package manifests at those exact release tags.
No server, paid runner, personal access token, npm dependencies or GitHub Pages site is needed.

## Use in a README

```markdown
[![Minimum Unity version](https://raw.githubusercontent.com/VPDPersonal/VPDPersonal/main/badges/aspid-collections/status-badge-unity.svg)](#installation)
[![Stable release](https://raw.githubusercontent.com/VPDPersonal/VPDPersonal/main/badges/aspid-collections/status-badge-release.svg)](https://github.com/VPDPersonal/Aspid.Collections/releases/latest)
[![MIT License](https://raw.githubusercontent.com/VPDPersonal/VPDPersonal/main/badges/status-badge-license.svg)](LICENSE)
```

Replace `aspid-collections` with the configured project slug. For a preview channel, use
`status-badge-preview.svg` and `preview/status-badge-unity.svg`, and link the version badge to the project's
`/releases` page. Preview files exist only when the project has a published prerelease.
Keep alt text independent of the displayed version so that it stays useful after an automatic update.
Each repository keeps its own installation, release and license link targets.

These links always describe the current published channel, even in an old README or package archive.
For an immutable historical snapshot, pin the central repository's commit SHA in place of `main`.

## Update and verify

```sh
node --test scripts/badges/*.test.mjs
node scripts/badges/generate.mjs          # Fetch published releases and refresh SVGs and sources.json.
node scripts/badges/generate.mjs --check  # Verify committed SVGs offline against sources.json and templates.
node scripts/badges/generate.mjs --offline # Regenerate from the saved source data after a design edit.
```

Use Node.js 22 or newer. A local `GITHUB_TOKEN` is optional, and is sent only to api.github.com.
Actions uses its built-in token. Nothing is rewritten if a source request or release validation fails.
There are no generation timestamps, and unchanged content produces no new commit.

The `Shared Aspid badges` workflow checks pull requests, refreshes on generator changes merged into `main`,
and polls hourly at minute 23 UTC. It can also be run manually from Actions. Updates become visible after
the workflow and GitHub's image caches refresh; scheduled jobs can be delayed by GitHub.
GitHub disables scheduled workflows after 60 days without repository activity; re-enable the workflow in
Actions if that happens. No permanent service is running between refreshes.

## Add a project or change the design

Add a unique slug, GitHub repository and ordered list of manifest paths to
[`projects.json`](../scripts/badges/projects.json), then refresh and commit the generated files.
Manifest paths are tried at the release tag, allowing package layout migrations without reading `main`.
Stable follows GitHub's designated latest stable release; preview follows the most recently published
non-draft prerelease, even if it predates the current stable release. Tag versions, package versions and
release channels must agree. Only MIT packages are currently supported.

Edit the four templates under [`scripts/badges/templates`](../scripts/badges/templates) to change all
consumers together. Widths grow with version text; output stays a portable 32px-high SVG.
