import {readFile, mkdir, writeFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite, fetchProject} from './badges/generate.mjs';
import {ensureBanners, copyBanners, sourceDigest as bannerDigest, cacheIsValid as bannerCacheValid} from './banners/render.mjs';
import {ensureInstallations, copyInstallations, sourceDigest as installationDigest, cacheIsValid as installationCacheValid} from './installation/render.mjs';

export async function buildReadmeSite(projects, output, {getBanners = ensureBanners, getInstallations = ensureInstallations, loadProject = fetchProject} = {}) {
  const sources = await Promise.all(projects.map(project => loadProject(project)));
  const cache = await getBanners(projects);
  const installations = await getInstallations(sources);
  await buildSite(sources, output, async project => project);
  await copyBanners(projects, cache, output);
  await copyInstallations(sources, installations, output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && !['--prepare', '--cache-status'].includes(process.argv[2]))) throw new Error('Usage: node scripts/build-site.mjs [--prepare|--cache-status]');
  const projects = JSON.parse(await readFile(new URL('./badges/projects.json', import.meta.url), 'utf8'));
  const snapshot = fileURLToPath(new URL('../.artifacts/published-projects.json', import.meta.url));
  const output = fileURLToPath(new URL('../.artifacts/readme-site', import.meta.url));
  const githubOutput = async values => {
    const text = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, text);
    else process.stdout.write(text);
  };
  if (process.argv[2] === '--prepare') {
    const sources = await Promise.all(projects.map(project => fetchProject(project)));
    await mkdir(path.dirname(snapshot), {recursive: true});
    await writeFile(snapshot, `${JSON.stringify(sources, null, 2)}\n`);
    await githubOutput({'banners-digest': await bannerDigest(projects), 'installation-digest': await installationDigest(sources)});
  } else if (process.argv[2] === '--cache-status') {
    const sources = JSON.parse(await readFile(snapshot, 'utf8'));
    const bannersValid = await bannerCacheValid(projects, fileURLToPath(new URL('../.artifacts/banner-cache', import.meta.url)), await bannerDigest(projects));
    const installationsValid = await installationCacheValid(sources);
    await githubOutput({'needs-renderer': !(bannersValid && installationsValid)});
  } else {
    const prepared = process.env.ASPID_README_SOURCES ? JSON.parse(await readFile(process.env.ASPID_README_SOURCES, 'utf8')) : null;
    await buildReadmeSite(prepared ?? projects, output, prepared ? {loadProject: async project => project} : {});
    console.log(`Built shared README media in ${output}`);
  }
}
