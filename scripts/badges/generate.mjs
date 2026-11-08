import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
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
  const title = kind === 'unity' ? `Unity ${value}+` : `${kind === 'preview' ? 'Preview' : 'Stable'} ${value}`;
  const width = kind === 'unity' ? 37 + textWidth(title) + 14 : (kind === 'preview' ? 90 : 82) + textWidth(value) + 14;
  const tokens = {title, version: value, width, outlineWidth: width - 1};
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`Unknown template token: ${key}`);
    return escapeXml(tokens[key]);
  });
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
      return releaseData(release, JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
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

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !['--check', '--offline'].includes(flag))) throw new Error('Usage: node scripts/badges/generate.mjs [--check | --offline]');
  const check = flags.includes('--check');
  const output = path.join(root, 'badges');
  const projects = JSON.parse(await readFile(path.join(directory, 'projects.json'), 'utf8'));
  if (new Set(projects.map((project) => project.slug)).size !== projects.length) throw new Error('Duplicate badge project slug');
  // Fetch every source before writing anything. A failed API call leaves all previously published SVGs intact.
  const sources = check || flags.includes('--offline')
    ? JSON.parse(await readFile(path.join(output, 'sources.json'), 'utf8'))
    : await Promise.all(projects.map((project) => fetchProject(project)));
  if (JSON.stringify(sources.map(({stable, preview, ...project}) => project)) !== JSON.stringify(projects)) {
    throw new Error('Badge sources do not match projects.json; refresh from GitHub');
  }
  for (const source of sources) {
    for (const [channel, release] of [['stable', source.stable], ['preview', source.preview]]) {
      if (release) releaseData({tag_name: release.tag, prerelease: channel === 'preview'}, {
        version: release.version, unity: release.unity.split('.').slice(0, 2).join('.'),
        unityRelease: release.unity.split('.')[2], license: release.license,
      });
    }
  }
  const files = await generatedFiles(sources);
  files.set('sources.json', `${JSON.stringify(sources, null, 2)}\n`);
  const existing = await readdir(output, {recursive: true}).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const obsolete = existing.filter((file) => /(?:^|\/)status-badge-[\w-]+\.svg$/.test(file) && !files.has(file));
  let changes = 0;
  for (const [relative, content] of files) {
    const destination = path.join(output, relative);
    const current = await readFile(destination, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current === content) continue;
    if (check) throw new Error(`Outdated badge: badges/${relative}`);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, content);
    changes++;
  }
  if (check && obsolete.length) throw new Error(`Obsolete badges: ${obsolete.join(', ')}`);
  for (const relative of obsolete) await rm(path.join(output, relative));
  console.log(check ? `Verified ${files.size} generated files` : `Updated ${changes} files; removed ${obsolete.length} obsolete badges`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {console.error(error.message); process.exitCode = 1;});
}
