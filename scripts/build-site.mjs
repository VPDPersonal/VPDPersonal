import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite} from './badges/generate.mjs';
import {ensureBanners, copyBanners} from './banners/render.mjs';

export async function buildReadmeSite(projects, output, {getBanners = ensureBanners, loadProject} = {}) {
  const cache = await getBanners(projects);
  await buildSite(projects, output, loadProject);
  await copyBanners(projects, cache, output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projects = JSON.parse(await readFile(new URL('./badges/projects.json', import.meta.url), 'utf8'));
  const output = fileURLToPath(new URL('../.artifacts/readme-site', import.meta.url));
  await buildReadmeSite(projects, output);
  console.log(`Built shared README media in ${output}`);
}
