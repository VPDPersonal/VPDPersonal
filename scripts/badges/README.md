# Shared Aspid badges

The generator keeps Aspid's existing badge artwork, including light and dark system themes. It reads published
GitHub releases and the Unity manifests at those exact release tags. Git contains only the generator,
configuration, templates, tests and this guide. Generated SVGs and source snapshots are never committed.

## Use in a README

```markdown
[![Minimum Unity version](https://vpdpersonal.github.io/VPDPersonal/badges/aspid-collections/status-badge-unity.svg)](#installation)
[![Stable release](https://vpdpersonal.github.io/VPDPersonal/badges/aspid-collections/status-badge-release.svg)](https://github.com/VPDPersonal/Aspid.Collections/releases/latest)
[![MIT License](https://vpdpersonal.github.io/VPDPersonal/badges/status-badge-license.svg)](LICENSE)
```

Replace `aspid-collections` with the configured project slug. For a preview channel, use
`status-badge-preview.svg` and `preview/status-badge-unity.svg`, and link the version badge to the project's
`/releases` page. Preview files exist only when the project has a published prerelease.
Keep alt text independent of the displayed version. Each repository keeps its own installation, release
and license link targets. Images describe the current published channel, including when viewed from an old README.
The generated site's index lists the available badges and links to their permanent SVG URLs.

## Build and publish

```sh
node --test scripts/badges/*.test.mjs
node scripts/badges/generate.mjs
```

Use Node.js 22 or newer. The badge-only build fetches current published data and writes a local preview to
`.artifacts/badges-site/`, which is ignored by Git. A local `GITHUB_TOKEN` is optional and is sent only to
api.github.com. Actions uses its built-in token. No npm dependencies, personal access token or separate server
is required.

The production `npm run build` command combines badges with cached banners and installation walkthroughs in `.artifacts/readme-site/`; see `../banners/README.md` and `../installation/README.md`. Enable GitHub Pages for this repository with **Source: GitHub Actions**. The `Shared Aspid README media` workflow
tests and builds pull requests, but deploys only from `main`. It publishes after generator changes reach `main`,
hourly at minute 23 UTC, or when run manually. The site is served at
`https://vpdpersonal.github.io/VPDPersonal/`. Build artifacts have one-day retention; the deployed site remains
available independently of artifact retention.

The workflow has read-only repository contents access and never creates commits. Only the deployment job
can write Pages deployments and request its OIDC token. An API or build failure stops publication, keeping
the previous successful site online. No release versions or timestamps need to be updated in Git.
Updates become visible after the workflow and GitHub's image caches refresh. GitHub can delay scheduled
jobs and disables them after 60 days of repository inactivity; re-enable the workflow in Actions if necessary.

## Add a project or change the design

Add a unique slug, repository and ordered list of manifest paths to [`projects.json`](projects.json).
Manifest paths are tried at the release tag, supporting older package layouts without reading `main`.
Stable follows GitHub's designated latest stable release; preview follows the most recently published
non-draft prerelease, even when it predates the current stable release. Tag versions, package versions and
release channels must agree. Only MIT packages are currently supported.

An exact historical stable tag can be listed in `legacyReleases` when it predates the UPM manifest. This opt-in
publishes only the release-version badge: it does not infer a Unity minimum or advertise a Git installation.
Manifests are still preferred when present; missing manifests for unlisted releases remain build errors.
Aspid.MVVM uses this compatibility entry for `v1.0.5`; its published preview uses the regular tagged manifest.

Edit the SVG templates under [`templates`](templates) to change consumers together. Widths grow with version
text; output stays a portable 32px-high SVG. The HTML template provides a small badge index for Pages.
