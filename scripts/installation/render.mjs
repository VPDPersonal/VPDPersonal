import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {inspectPng, inspectWebp} from '../banners/render.mjs';

const run = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
export const WIDTH = 896;
export const HEIGHT = 460;
export const FRAME_MS = 50;
export const DURATION = 8200;
export const FALLBACK_TIME = 4300;
export const CACHE = path.join(root, '.artifacts/installation-cache');

export function installationJobs(sources) {
  const jobs = [];
  const slugs = new Set();
  for (const project of sources.filter(project => project.installation)) {
    if (project.installation !== true || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug) || slugs.has(project.slug)
      || !/^[\w.-]+\/[\w.-]+$/.test(project.repository)) throw new Error('Invalid installation project');
    slugs.add(project.slug);
    for (const channel of ['stable', 'preview']) {
      const release = project[channel];
      if (!release) continue;
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(release.packageId ?? '')
        || typeof release.packageName !== 'string' || !release.packageName.trim() || release.packageName.length > 80
        || /[\x00-\x1f]/.test(release.packageName) || !/^[0-9A-Za-z.+-]{1,100}$/.test(release.version ?? '')) {
        throw new Error(`Invalid installation manifest: ${project.slug}/${channel}`);
      }
      jobs.push({
        slug: project.slug, channel,
        relative: `${project.slug}${channel === 'preview' ? '/preview' : ''}`,
        packageName: release.packageName, packageId: release.packageId, version: release.version,
        url: `https://github.com/${project.repository}.git#${channel === 'preview' ? 'upm-preview' : 'upm'}`,
      });
    }
  }
  return jobs;
}

export async function sourceDigest(sources) {
  const hash = createHash('sha256').update(process.platform).update(JSON.stringify(installationJobs(sources)));
  const files = (await readdir(directory, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter(file => /\.(?:html|js|mjs|css|woff2)$/.test(file) && !file.endsWith('.test.mjs')).sort();
  for (const file of files) hash.update(path.relative(directory, file)).update(await readFile(file));
  hash.update(await readFile(path.join(root, 'package-lock.json')));
  return hash.digest('hex');
}

export function validAnimation(buffer) {
  const image = inspectWebp(buffer);
  return image.width === WIDTH && image.height === HEIGHT && image.loop === 0 && image.durations.length > 1
    && image.durations.length <= DURATION / FRAME_MS && image.durations.every(value => value > 0 && value % FRAME_MS === 0)
    && image.durations.reduce((sum, value) => sum + value, 0) === DURATION;
}

async function validateFiles(sources, output, manifest) {
  for (const job of installationJobs(sources)) {
    for (const format of ['png', 'webp']) {
      const relative = `${job.relative}/install.${format}`;
      const buffer = await readFile(path.join(output, relative));
      if (createHash('sha256').update(buffer).digest('hex') !== manifest.files[relative]) return false;
      if (format === 'webp') {if (!validAnimation(buffer)) return false;}
      else {const image = inspectPng(buffer); if (image.width !== WIDTH * 2 || image.height !== HEIGHT * 2) return false;}
    }
  }
  return true;
}

export async function cacheIsValid(sources, output = CACHE, digest) {
  if (!installationJobs(sources).length) return true;
  try {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    return manifest.digest === (digest ?? await sourceDigest(sources)) && await validateFiles(sources, output, manifest);
  } catch {return false;}
}

export async function loadInstallationPage(page, job) {
  const errors = [];
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${pathToFileURL(path.join(directory, 'template.html'))}?capture=1`);
  await page.evaluate(() => window.ready);
  await page.evaluate(value => window.AspidInstallation.configure(value), job);
  const fits = await page.locator('#typed').evaluate(element => {
    const field = element.parentElement.getBoundingClientRect();
    const text = element.getBoundingClientRect();
    return text.left >= field.left && text.right <= field.right;
  });
  if (!fits || errors.length) throw new Error(`Installation capture failed: ${errors.join('; ') || 'URL overflows its field'}`);
}

export async function ensureInstallations(sources, output = CACHE) {
  const jobs = installationJobs(sources);
  if (!jobs.length) return output;
  const digest = await sourceDigest(sources);
  if (await cacheIsValid(sources, output, digest)) {console.log('Using cached installation walkthroughs'); return output;}
  const {chromium} = await import('playwright');
  await mkdir(path.dirname(output), {recursive: true});
  const staging = await mkdtemp(path.join(path.dirname(output), '.aspid-installation-build-'));
  let browser;
  const manifest = {digest, width: WIDTH, height: HEIGHT, duration: DURATION, frameMs: FRAME_MS, files: {}};
  try {
    browser = await chromium.launch({headless: true, ...(process.env.ASPID_BANNER_BROWSER ? {executablePath: process.env.ASPID_BANNER_BROWSER} : {})});
    for (const job of jobs) {
      const destination = path.join(staging, job.relative);
      await mkdir(destination, {recursive: true});
      const still = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 2});
      await loadInstallationPage(still, job);
      await still.screenshot({path: path.join(destination, 'install.png')});
      await still.close();
      const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1});
      await loadInstallationPage(page, job);
      const frames = path.join(staging, `${job.slug}-${job.channel}-frames`);
      await mkdir(frames);
      const inputs = [];
      for (let time = 0; time < DURATION; time += FRAME_MS) {
        // Start with the complete URL, so the first frame is useful before animation playback begins.
        await page.evaluate(value => window.AspidInstallation.renderAt(value), (time + FALLBACK_TIME) % DURATION);
        const file = path.join(frames, `${String(time).padStart(5, '0')}.png`);
        await page.screenshot({path: file});
        inputs.push(file);
      }
      await page.close();
      // Lossless encoding prevents old UI text from leaving ghosts on updated animation patches.
      await run('img2webp', ['-loop', '0', '-lossless', '-m', '6', '-d', String(FRAME_MS), ...inputs, '-o', path.join(destination, 'install.webp')]);
      await rm(frames, {recursive: true});
      for (const format of ['png', 'webp']) {
        const relative = `${job.relative}/install.${format}`;
        manifest.files[relative] = createHash('sha256').update(await readFile(path.join(staging, relative))).digest('hex');
      }
      console.log(`Rendered installation: ${job.packageName} ${job.channel} ${job.version}`);
    }
    if (!await validateFiles(sources, staging, manifest)) throw new Error('Installation image validation failed');
    await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(output, {recursive: true, force: true});
    await rename(staging, output);
  } finally {await browser?.close(); await rm(staging, {recursive: true, force: true});}
  return output;
}

export async function copyInstallations(sources, cache, output) {
  for (const job of installationJobs(sources)) {
    const destination = path.join(output, 'installation', job.relative);
    await mkdir(destination, {recursive: true});
    for (const format of ['png', 'webp']) await cp(path.join(cache, job.relative, `install.${format}`), path.join(destination, `install.${format}`));
  }
}
