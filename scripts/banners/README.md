# Shared README banners

The project configuration is `scripts/badges/projects.json`. Each project with a `banner` object supplies its
`title` and `subtitle`; the shared scene supplies the logo, typography, dot field, green glow and looping sparks.
The heading fits the available text column automatically. Unsupported or overflowing text fails the build.

The source layout, logo and glow mask come from Aspid.Media.Storage's dark green README banner. The exported
animated HTML contains a finished WebP, not an editable animation scene. The shared canvas scene rebuilds its
subtle dot/glow/spark motion as a deterministic loop; it does not store or modify a rendered package banner.
`source.json` records the source archive and its digest. IBM Plex 500 fonts are vendored with their OFL licenses.

## Render locally

Use Node.js 22, Playwright Chromium and the WebP tools (`img2webp`):

```sh
npm ci
npx playwright install chromium
npm run build:banners
npm run build
```

Install WebP tools with `brew install webp` on macOS or `sudo apt-get install webp` on Ubuntu.
To use an already installed Chrome instead of downloading Chromium:

```sh
ASPID_BANNER_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run build:banners
```

Rendering runs headlessly and uses local fonts and assets. Output is generated under `.artifacts/`, which is
ignored by Git. Each project produces a 2560×768 PNG fallback and a 1280×384 animated WebP: 196 frames,
40 milliseconds each, looping indefinitely. Text uses DOM text nodes, not HTML interpolation.

## Cache and publish

The renderer checks an input digest, image dimensions, animation timing and output checksums before reusing
`.artifacts/banner-cache/`. Changing project text, source assets, scene code or the dependency lockfile invalidates
that cache. Published release versions do not invalidate it. A failed render does not replace the last complete
cache. `manifest.json` describes the generated outputs; it is generated and never committed.

The Pages workflow restores a cache keyed by rendering inputs. Only a cache miss installs the browser/WebP tools
and renders frames. `npm run build` combines cached banners with freshly generated release badges into one
`.artifacts/readme-site/` artifact. A single deployment publishes both directories together, so a badge refresh
cannot remove banners. Pull requests build and validate the same artifact but do not deploy it.

Use permanent URLs in README pictures:

```html
<picture>
  <source srcset="https://vpdpersonal.github.io/VPDPersonal/banners/aspid-collections/banner.webp" type="image/webp" />
  <img src="https://vpdpersonal.github.io/VPDPersonal/banners/aspid-collections/banner.png" alt="Aspid.Collections" />
</picture>
```

Replace the project slug for another configured package. Before merging a consumer README change, publish the
producer PR and verify both banner URLs. Generated media is not checked into this repository or consumer packages.
