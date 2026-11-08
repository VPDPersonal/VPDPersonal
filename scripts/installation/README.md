# Shared installation walkthroughs

Set `installation: true` in `scripts/badges/projects.json` to generate the Package Manager illustration for a project.
The generator reads the package name, ID and version from the same tagged manifest as its badges. Stable channels
type `#upm`; preview channels type `#upm-preview`. Only published channels produce images.
Configured historical releases without a UPM manifest produce no Git installation image. Aspid.MVVM currently
has a preview walkthrough at `installation/aspid-mvvm/preview/install.webp` and `install.png`; its legacy stable
release remains available as a version badge. A future manifest-backed stable release enables its stable walkthrough.

The scene preserves the existing FastTools Package Manager layout and five stages: open the window, choose the Git
URL menu, type the URL, install, and show the installed package. Source provenance is recorded in `source.json`.
The 8.2-second loop is captured at 20 fps and encoded losslessly to avoid text ghosts. Identical held frames may be
combined while retaining their duration. WebP output is 896×460; the static PNG fallback is 1792×920 and shows the
complete URL. Browser capture checks the URL fits, resource loading and every stage at 1×/2× pixel density.

## Use in a README

Use the shared illustration beside three native text steps, followed by a copyable URL block. The illustration is
the same in English and Russian; Unity's menu names stay in English. For example, the stable Collections image is:

```html
<picture>
  <source srcset="https://vpdpersonal.github.io/VPDPersonal/installation/aspid-collections/install.webp" type="image/webp">
  <img src="https://vpdpersonal.github.io/VPDPersonal/installation/aspid-collections/install.png" alt="Package Manager installs Aspid.Collections from its Git URL" width="100%">
</picture>
```

Replace the slug for another configured package. Preview images use `installation/<slug>/preview/install.webp` and
`install.png` and must be paired with the copyable `#upm-preview` command. Publish the producer before merging a
consumer README change. FastTools' README generator selects this path automatically from the command's channel.

## Render and publish

Install the existing repository dependencies, Playwright Chromium and WebP tools (`brew install webp` on macOS,
`sudo apt-get install webp` on Ubuntu). Run `npm test`, `npm run test:media-browser` and `npm run build`.
Set `ASPID_BANNER_BROWSER` to an installed Chromium/Chrome executable when needed. All captures run headlessly.

The Pages workflow prepares one ignored `.artifacts/published-projects.json` snapshot and uses it for badges and
installation images together. Separate cache keys cover the renderer inputs and the actual visible release data.
A release change updates its illustration without invalidating banner artwork. Cache contents are validated before
deciding whether browser tools are needed. Pull requests always run browser checks; scheduled runs reuse valid
output without launching a browser. Missing or corrupt cache files trigger a fresh render.

The combined Pages artifact contains banners, badges and installation images. A failed fetch or capture stops
publication and keeps the previous deployed site online. Generated PNG/WebP files, cache manifests and published
source snapshots are ignored and never committed.
