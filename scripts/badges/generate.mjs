import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));

// Estimate the same 13px system-font metrics used by the original badges, leaving padding for platform differences.
export function textWidth(text) {
  return Math.ceil([...text].reduce((width, char) => width + (
    /[0-9]/.test(char) ? 7.4 : /[. ]/.test(char) ? 3.6 : /[-+]/.test(char) ? 7 : /[A-Z]/.test(char) ? 8.5 : 6.8
  ), 0));
}

export async function renderBadge(kind, value = '') {
  const template = await readFile(path.join(directory, 'templates', `${kind}.svg`), 'utf8');
  if (kind === 'license') return template;
  const title = kind === 'unity' ? `Unity ${value}+` : `${kind === 'preview' ? 'Preview' : 'Stable'} ${value}`;
  const width = kind === 'unity' ? 37 + textWidth(title) + 14 : (kind === 'preview' ? 90 : 82) + textWidth(value) + 14;
  const tokens = {title, version: value};
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`Unknown template token: ${key}`);
    return escapeXml(tokens[key]);
  })
    // Numeric defaults keep the source SVG previewable; generated badges resize to their actual text.
    .replace(/(<svg\b[^>]*\bwidth=")\d+/, (_, prefix) => `${prefix}${width}`)
    .replace(/(<svg\b[^>]*\bviewBox=")0 0 \d+ 32/, (_, prefix) => `${prefix}0 0 ${width} 32`)
    .replace(/(<rect\b[^>]*class="outline"[^>]*\bwidth=")\d+/, (_, prefix) => `${prefix}${width - 1}`);
}

export function releaseData(release, manifest) {
  const version = release.tag_name.replace(/^v/, '');
  const match = semver.exec(version);
  if (!match || version !== manifest.version || Boolean(match[4]) !== release.prerelease) {
    throw new Error(`Release ${release.tag_name} disagrees with package version or channel (${manifest.version})`);
  }
  if (!/^\d{4}\.\d+$/.test(manifest.unity) || (manifest.unityRelease && !/^\d+[abfp]\d+$/.test(manifest.unityRelease))) {
    throw new Error(`Invalid minimum Unity version in ${release.tag_name}`);
  }
  if (manifest.license !== 'MIT') throw new Error(`Unsupported license in ${release.tag_name}: ${manifest.license}`);
  return {
    tag: release.tag_name,
    version,
    unity: manifest.unityRelease ? `${manifest.unity}.${manifest.unityRelease}` : manifest.unity,
    license: manifest.license,
  };
}

async function github(resource, optional = false) {
  const response = await fetch(`https://api.github.com${resource}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Aspid.Badges',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`} : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${resource}`);
  return response.json();
}

export async function fetchProject(project, request = github) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug) || !/^[\w.-]+\/[\w.-]+$/.test(project.repository)) {
    throw new Error('Invalid badge project configuration');
  }
  const api = `/repos/${project.repository}`;
  const stable = await request(`${api}/releases/latest`, true);
  let preview = null;
  // Releases are paginated; drafts and stable releases must never hide a published preview on a later page.
  for (let page = 1; ; page++) {
    const releases = await request(`${api}/releases?per_page=100&page=${page}`);
    for (const release of releases) {
      if (!release.draft && release.prerelease && release.published_at
        && (!preview || release.published_at > preview.published_at)) preview = release;
    }
    if (releases.length < 100) break;
  }
  if (!stable && !preview) throw new Error(`No published releases for ${project.repository}`);
  if (stable && (stable.draft || stable.prerelease || !stable.published_at)) throw new Error(`Invalid stable release for ${project.repository}`);

  async function manifestFor(release) {
    if (!release) return null;
    for (const candidate of project.manifests) {
      const file = await request(`${api}/contents/${candidate}?ref=${encodeURIComponent(release.tag_name)}`, true);
      if (!file) continue;
      if (file.encoding !== 'base64' || file.type !== 'file') throw new Error(`Invalid manifest: ${candidate}`);
      const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
      const data = releaseData(release, manifest);
      return project.installation ? {...data, packageId: manifest.name, packageName: manifest.displayName} : data;
    }
    throw new Error(`No package manifest at ${project.repository}@${release.tag_name}`);
  }
  return {...project, stable: await manifestFor(stable), preview: await manifestFor(preview)};
}

export async function generatedFiles(sources) {
  const files = new Map([['status-badge-license.svg', await renderBadge('license')]]);
  for (const project of sources) {
    for (const [channel, release] of [['stable', project.stable], ['preview', project.preview]]) {
      if (!release) continue;
      files.set(`${project.slug}/status-badge-${channel === 'stable' ? 'release' : 'preview'}.svg`,
        await renderBadge(channel === 'stable' ? 'release' : 'preview', release.version));
      files.set(`${project.slug}/${channel === 'preview' ? 'preview/' : ''}status-badge-unity.svg`,
        await renderBadge('unity', release.unity));
    }
  }
  return files;
}

async function siteIndex(sources) {
  const template = await readFile(path.join(directory, 'templates/index.html'), 'utf8');
  const projects = sources.map((project) => {
    const repository = `https://github.com/${project.repository}`;
    const channels = [['Stable', project.stable], ['Preview', project.preview]].flatMap(([label, release]) => {
      if (!release) return [];
      const kind = label === 'Stable' ? 'release' : 'preview';
      const unity = `badges/${project.slug}/${label === 'Preview' ? 'preview/' : ''}status-badge-unity.svg`;
      const installation = `installation/${project.slug}/${label === 'Preview' ? 'preview/' : ''}install`;
      const walkthrough = project.installation
        ? `<picture class="walkthrough"><source srcset="${installation}.webp" type="image/webp"><img src="${installation}.png" alt="Install ${escapeXml(project.repository.split('/')[1])} ${escapeXml(release.version)} from Git" width="896" height="460"></picture>`
        : '';
      return [`<div class="channel"><h3>${label}</h3><div class="badges">
        <a href="${repository}/releases${label === 'Stable' ? '/latest' : ''}"><img src="badges/${project.slug}/status-badge-${kind}.svg" alt="${label} ${escapeXml(release.version)}"></a>
        <a href="${unity}"><img src="${unity}" alt="Unity ${escapeXml(release.unity)} or newer"></a>
      </div></div>${walkthrough}`];
    }).join('\n');
    const banner = project.banner
      ? `<picture class="banner"><source srcset="banners/${project.slug}/banner.webp" type="image/webp"><img src="banners/${project.slug}/banner.png" alt="${escapeXml(project.banner.title)}" width="1280" height="384"></picture>`
      : '';
    return `<article><h2><a href="${repository}">${escapeXml(project.repository.split('/')[1])}</a></h2>${banner}${channels}</article>`;
  }).join('\n');
  return template.replace('{{projects}}', projects);
}

export async function buildSite(projects, output, loadProject = fetchProject) {
  if (new Set(projects.map((project) => project.slug)).size !== projects.length) throw new Error('Duplicate badge project slug');
  // A failed fetch or build never replaces the previous output. Pages deploys only the fully built artifact.
  const sources = await Promise.all(projects.map((project) => loadProject(project)));
  const badges = await generatedFiles(sources);
  const files = new Map([...badges].map(([relative, content]) => [`badges/${relative}`, content]));
  files.set('badges/sources.json', `${JSON.stringify(sources, null, 2)}\n`);
  files.set('index.html', await siteIndex(sources));
  files.set('.nojekyll', '');
  await mkdir(path.dirname(output), {recursive: true});
  const staging = await mkdtemp(path.join(path.dirname(output), '.aspid-badges-'));
  try {
    for (const [relative, content] of files) {
      const destination = path.join(staging, relative);
      await mkdir(path.dirname(destination), {recursive: true});
      await writeFile(destination, content);
    }
    await rm(output, {recursive: true, force: true});
    await rename(staging, output);
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
  return files.size;
}

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/badges/generate.mjs');
  const projects = JSON.parse(await readFile(path.join(directory, 'projects.json'), 'utf8')).map(({banner, installation, ...project}) => project);
  const output = path.join(root, '.artifacts/badges-site');
  const count = await buildSite(projects, output);
  console.log(`Built ${count} files in ${path.relative(root, output)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {console.error(error.message); process.exitCode = 1;});
}
