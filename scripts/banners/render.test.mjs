import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {bannerProjects, cacheIsValid, inspectPng, inspectWebp, sourceDigest} from './render.mjs';
import {buildReadmeSite} from '../build-site.mjs';

const project = {slug: 'aspid-example', banner: {title: 'Aspid.Example', subtitle: 'A reusable banner'}};

test('project text is configurable while output paths remain inside the banner directory', () => {
  assert.deepEqual(bannerProjects([project, {slug: 'without-banner'}]), [project]);
  assert.throws(() => bannerProjects([{...project, slug: '../elsewhere'}]), /slug/);
  assert.throws(() => bannerProjects([project, project]), /duplicate/);
  assert.throws(() => bannerProjects([{...project, banner: {...project.banner, title: ''}}]), /title/);
  assert.throws(() => bannerProjects([{...project, banner: {...project.banner, subtitle: 'first\nsecond'}}]), /subtitle/);
});

test('a text or project change invalidates cached banners, without depending on release versions', async () => {
  const first = await sourceDigest([project]);
  assert.equal(await sourceDigest([{...project, stable: {version: '99.0.0'}}]), first);
  assert.notEqual(await sourceDigest([{...project, banner: {...project.banner, subtitle: 'Changed'}}]), first);
  assert.notEqual(await sourceDigest([{...project, slug: 'aspid-another'}]), first);
});

function chunk(kind, payload) {
  const result = Buffer.alloc(8 + payload.length + payload.length % 2);
  result.write(kind); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8);
  return result;
}

function webp() {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 2; vp8x.writeUIntLE(1279, 4, 3); vp8x.writeUIntLE(383, 7, 3);
  const animation = Buffer.alloc(6);
  const frame = Buffer.alloc(16); frame.writeUIntLE(40, 12, 3);
  const data = Buffer.concat([chunk('VP8X', vp8x), chunk('ANIM', animation), ...Array.from({length: 196}, () => chunk('ANMF', frame))]);
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(data.length + 4, 4); header.write('WEBP', 8);
  return Buffer.concat([header, data]);
}

test('animated WebP inspection verifies canvas, looping, frame count and timing', () => {
  const image = inspectWebp(webp());
  assert.equal(image.width, 1280); assert.equal(image.height, 384);
  assert.equal(image.loop, 0); assert.equal(image.durations.length, 196);
  assert.ok(image.durations.every(duration => duration === 40));
  assert.throws(() => inspectWebp(Buffer.from('broken')), /Invalid WebP/);
  const truncated = webp(); truncated.writeUInt32LE(100000, 16);
  assert.throws(() => inspectWebp(truncated), /Truncated/);
});

test('cache validation rejects missing, changed or corrupt render files', async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), 'aspid-banner-cache-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  assert.equal(await cacheIsValid([project], output, 'input'), false);
  await mkdir(path.join(output, project.slug));
  const png = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.write('IHDR', 12); png.writeUInt32BE(2560, 16); png.writeUInt32BE(768, 20);
  assert.deepEqual(inspectPng(png), {width: 2560, height: 768});
  const files = {[`${project.slug}/banner.png`]: png, [`${project.slug}/banner.webp`]: webp()};
  const manifest = {digest: 'input', files: {}};
  for (const [name, buffer] of Object.entries(files)) {
    await writeFile(path.join(output, name), buffer);
    manifest.files[name] = createHash('sha256').update(buffer).digest('hex');
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(await cacheIsValid([project], output, 'input'), true);
  assert.equal(await cacheIsValid([project], output, 'different input'), false);
  await writeFile(path.join(output, project.slug, 'banner.webp'), 'damaged');
  assert.equal(await cacheIsValid([project], output, 'input'), false);
});

test('a fresh badge build keeps banners and all relative image URLs in the same Pages artifact', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aspid-media-site-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const cache = path.join(directory, 'cache');
  const output = path.join(directory, 'site');
  await mkdir(path.join(cache, project.slug), {recursive: true});
  for (const format of ['png', 'webp']) await writeFile(path.join(cache, project.slug, `banner.${format}`), `cached ${format}`);
  const configured = {...project, repository: 'VPDPersonal/Aspid.Example', manifests: ['package.json']};
  for (const version of ['1.0.0', '1.0.1']) {
    await buildReadmeSite([configured], output, {
      getBanners: async () => cache,
      loadProject: async entry => ({...entry, stable: {version, unity: '2021.3', license: 'MIT'}, preview: null}),
    });
    const index = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.ok(index.includes(`alt="Stable ${version}"`));
    for (const [, relative] of index.matchAll(/(?:src|srcset|href)="((?:banners|badges)\/[^"]+)"/g)) await readFile(path.join(output, relative));
    assert.equal(await readFile(path.join(output, 'banners', project.slug, 'banner.webp'), 'utf8'), 'cached webp');
  }
});
