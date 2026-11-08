import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';

const run = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
export const WIDTH = 1280;
export const HEIGHT = 384;
export const FRAMES = 196;
export const FRAME_MS = 40;

export function bannerProjects(projects) {
  const result = projects.filter(project => project.banner);
  const slugs = new Set();
  for (const project of result) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug) || slugs.has(project.slug)) throw new Error('Invalid or duplicate banner slug');
    slugs.add(project.slug);
    for (const [key, limit] of [['title', 100], ['subtitle', 180]]) {
      const value = project.banner[key];
      if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\r\n\x00-\x1f]/.test(value)) throw new Error(`Invalid banner ${key}`);
    }
  }
  return result;
}

export function inspectPng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG');
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

export function inspectWebp(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP' || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Invalid WebP');
  let width = 0, height = 0, loop = null;
  const durations = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error('Truncated WebP');
    if (kind === 'VP8X' && size >= 10) {width = buffer.readUIntLE(data + 4, 3) + 1; height = buffer.readUIntLE(data + 7, 3) + 1;}
    if (kind === 'ANIM' && size >= 6) loop = buffer.readUInt16LE(data + 4);
    if (kind === 'ANMF' && size >= 16) durations.push(buffer.readUIntLE(data + 12, 3));
    offset = data + size + (size % 2);
  }
  return {width, height, loop, durations};
}

export async function sourceDigest(projects) {
  const hash = createHash('sha256').update(process.platform).update(JSON.stringify(bannerProjects(projects).map(({slug, banner}) => ({slug, banner}))));
  const files = (await readdir(directory, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())
    .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter(file => /\.(?:html|js|mjs|png|woff2)$/.test(file) && !file.endsWith('.test.mjs')).sort();
  for (const file of files) hash.update(path.relative(directory, file)).update(await readFile(file));
  hash.update(await readFile(path.join(root, 'package-lock.json')));
  return hash.digest('hex');
}

async function validateFiles(projects, output, manifest) {
  for (const project of bannerProjects(projects)) {
    for (const format of ['png', 'webp']) {
      const relative = `${project.slug}/banner.${format}`;
      const buffer = await readFile(path.join(output, relative));
      if (createHash('sha256').update(buffer).digest('hex') !== manifest.files[relative]) return false;
      if (format === 'png') {
        const image = inspectPng(buffer);
        if (image.width !== WIDTH * 2 || image.height !== HEIGHT * 2) return false;
      } else {
        const image = inspectWebp(buffer);
        if (image.width !== WIDTH || image.height !== HEIGHT || image.loop !== 0 || image.durations.length !== FRAMES || image.durations.some(duration => duration !== FRAME_MS)) return false;
      }
    }
  }
  return true;
}

export async function cacheIsValid(projects, output, digest) {
  try {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    return manifest.digest === digest && await validateFiles(projects, output, manifest);
  } catch {return false;}
}

export async function ensureBanners(projects, output = path.join(root, '.artifacts/banner-cache')) {
  const configured = bannerProjects(projects);
  const digest = await sourceDigest(projects);
  if (await cacheIsValid(projects, output, digest)) {console.log('Using cached banners'); return output;}
  const {chromium} = await import('playwright');
  const browser = await chromium.launch({headless: true, ...(process.env.ASPID_BANNER_BROWSER ? {executablePath: process.env.ASPID_BANNER_BROWSER} : {})});
  await mkdir(path.dirname(output), {recursive: true});
  const staging = await mkdtemp(path.join(path.dirname(output), '.aspid-banner-build-'));
  const manifest = {digest, width: WIDTH, height: HEIGHT, frames: FRAMES, frameMs: FRAME_MS, files: {}};
  try {
    const url = `${pathToFileURL(path.join(directory, 'template.html'))}?capture=1`;
    for (const project of configured) {
      const destination = path.join(staging, project.slug);
      await mkdir(destination, {recursive: true});
      const still = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 2});
      await still.goto(url);
      await still.evaluate(() => window.ready);
      await still.evaluate(config => window.AspidBanner.configure(config), project.banner);
      const bounds = await still.locator('#copy').evaluate(element => {
        const rectangles = [...element.children].map(child => {
          const range = document.createRange(); range.selectNodeContents(child); return range.getBoundingClientRect();
        });
        return {left: Math.min(...rectangles.map(rect => rect.left)), right: Math.max(...rectangles.map(rect => rect.right))};
      });
      if (bounds.left < 0 || bounds.right > WIDTH) throw new Error(`Banner text overflows: ${project.slug}`);
      await still.screenshot({path: path.join(destination, 'banner.png')});
      await still.close();
      const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1});
      await page.goto(url);
      await page.evaluate(() => window.ready);
      await page.evaluate(config => window.AspidBanner.configure(config), project.banner);
      const frames = path.join(staging, `${project.slug}-frames`);
      await mkdir(frames);
      const inputs = [];
      for (let index = 0; index < FRAMES; index++) {
        await page.evaluate(time => window.AspidBanner.renderAt(time), index * FRAME_MS);
        const file = path.join(frames, `${String(index).padStart(4, '0')}.png`);
        await page.screenshot({path: file});
        inputs.push(file);
      }
      await page.close();
      await run('img2webp', ['-loop', '0', '-lossy', '-q', '80', '-m', '4', '-d', String(FRAME_MS), ...inputs, '-o', path.join(destination, 'banner.webp')]);
      await rm(frames, {recursive: true});
      for (const format of ['png', 'webp']) {
        const relative = `${project.slug}/banner.${format}`;
        manifest.files[relative] = createHash('sha256').update(await readFile(path.join(staging, relative))).digest('hex');
      }
      console.log(`Rendered ${project.banner.title}: PNG and ${FRAMES}-frame WebP`);
    }
    if (!await validateFiles(projects, staging, manifest)) throw new Error('Rendered banner validation failed');
    await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(output, {recursive: true, force: true});
    await rename(staging, output);
  } finally {
    await browser.close();
    await rm(staging, {recursive: true, force: true});
  }
  return output;
}

export async function copyBanners(projects, cache, output) {
  for (const project of bannerProjects(projects)) {
    await cp(path.join(cache, project.slug), path.join(output, 'banners', project.slug), {recursive: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projects = JSON.parse(await readFile(path.join(root, 'scripts/badges/projects.json'), 'utf8'));
  ensureBanners(projects).catch(error => {console.error(error.message); process.exitCode = 1;});
}
