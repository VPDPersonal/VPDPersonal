import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {installationJobs, sourceDigest, validAnimation, cacheIsValid} from './render.mjs';
import {buildReadmeSite} from '../build-site.mjs';

const release = {version: '1.2.3', packageName: 'Aspid.Example', packageId: 'tech.aspid.example', unity: '2021.3', license: 'MIT'};
const project = {slug: 'aspid-example', repository: 'VPDPersonal/Aspid.Example', installation: true, stable: release, preview: null};

test('installation jobs follow published channels and manifest identity', () => {
  const [stable, preview] = installationJobs([{...project, preview: {...release, version: '2.0.0-rc.1'}}]);
  assert.equal(stable.url, 'https://github.com/VPDPersonal/Aspid.Example.git#upm');
  assert.equal(preview.url, 'https://github.com/VPDPersonal/Aspid.Example.git#upm-preview');
  assert.equal(stable.relative, 'aspid-example');
  assert.equal(preview.relative, 'aspid-example/preview');
  assert.equal(preview.version, '2.0.0-rc.1');
  assert.equal(stable.packageName, release.packageName);
  assert.deepEqual(installationJobs([{...project, installation: false}]), []);
  assert.equal(installationJobs([{...project, stable: null, preview: release}]).length, 1);
  assert.throws(() => installationJobs([{...project, slug: '../elsewhere'}]), /Invalid installation project/);
  assert.throws(() => installationJobs([project, project]), /Invalid installation project/);
  assert.throws(() => installationJobs([{...project, stable: {...release, packageId: 'bad/id'}}]), /manifest/);
  assert.throws(() => installationJobs([{...project, stable: {...release, packageName: 'one\ntwo'}}]), /manifest/);
});

test('installation cache keys change with visible release data and channel URLs', async () => {
  const first = await sourceDigest([project]);
  assert.equal(await sourceDigest([{...project, stable: {...release, unity: '6000.0'}}]), first);
  for (const change of [{version: '1.2.4'}, {packageName: 'Another name'}, {packageId: 'tech.aspid.other'}]) {
    assert.notEqual(await sourceDigest([{...project, stable: {...release, ...change}}]), first);
  }
  assert.notEqual(await sourceDigest([{...project, preview: release}]), first);
  assert.notEqual(await sourceDigest([{...project, repository: 'VPDPersonal/Aspid.Other'}]), first);
});

function chunk(kind, payload) {
  const result = Buffer.alloc(8 + payload.length + payload.length % 2);
  result.write(kind); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8);
  return result;
}

function webp(durations = [4300, 3900]) {
  const vp8x = Buffer.alloc(10); vp8x[0] = 2; vp8x.writeUIntLE(895, 4, 3); vp8x.writeUIntLE(459, 7, 3);
  const data = Buffer.concat([chunk('VP8X', vp8x), chunk('ANIM', Buffer.alloc(6)), ...durations.map(duration => {
    const frame = Buffer.alloc(16); frame.writeUIntLE(duration, 12, 3); return chunk('ANMF', frame);
  })]);
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(data.length + 4, 4); header.write('WEBP', 8);
  return Buffer.concat([header, data]);
}

test('walkthrough validation accepts merged holds while preserving the complete loop duration', () => {
  assert.equal(validAnimation(webp()), true);
  assert.equal(validAnimation(webp([4100, 4100])), true);
  assert.equal(validAnimation(webp([4300, 3850])), false);
  assert.equal(validAnimation(webp([4301, 3899])), false);
  assert.equal(validAnimation(webp([8200])), false);
});

test('installation cache rejects changed, missing or corrupt media and mismatched sources', async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), 'aspid-installation-test-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  await mkdir(path.join(output, project.slug));
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.write('IHDR', 12); png.writeUInt32BE(1792, 16); png.writeUInt32BE(920, 20);
  const manifest = {digest: 'same', files: {}};
  for (const [format, body] of [['png', png], ['webp', webp()]]) {
    const file = `${project.slug}/install.${format}`;
    await writeFile(path.join(output, file), body);
    manifest.files[file] = createHash('sha256').update(body).digest('hex');
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(await cacheIsValid([project], output, 'same'), true);
  assert.equal(await cacheIsValid([project], output, 'different'), false);
  await writeFile(path.join(output, project.slug, 'install.webp'), 'damaged');
  assert.equal(await cacheIsValid([project], output, 'same'), false);
});

test('one published snapshot supplies every media type and withdrawn previews leave no broken gallery URLs', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aspid-readme-installation-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const banners = path.join(directory, 'banners');
  const installations = path.join(directory, 'installation');
  const output = path.join(directory, 'site');
  await mkdir(path.join(banners, project.slug), {recursive: true});
  for (const format of ['png', 'webp']) await writeFile(path.join(banners, project.slug, `banner.${format}`), 'banner');
  for (const relative of [project.slug, `${project.slug}/preview`]) {
    await mkdir(path.join(installations, relative), {recursive: true});
    for (const format of ['png', 'webp']) await writeFile(path.join(installations, relative, `install.${format}`), 'installation');
  }
  let loads = 0;
  for (const preview of [release, null]) {
    const configured = {...project, banner: {title: 'Aspid.Example', subtitle: 'Example'}};
    await buildReadmeSite([configured], output, {
      loadProject: async entry => {loads++; return {...entry, preview};},
      getBanners: async () => banners,
      getInstallations: async sources => {
        assert.equal(sources[0].stable.version, release.version);
        assert.equal(sources[0].preview, preview);
        return installations;
      },
    });
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    for (const [, file] of html.matchAll(/(?:src|srcset|href)="((?:banners|badges|installation)\/[^"]+)"/g)) await readFile(path.join(output, file));
    assert.equal(html.includes('installation/aspid-example/preview/install.webp'), Boolean(preview));
  }
  assert.equal(loads, 2, 'each build loads published data once, before generating any media');
  await assert.rejects(readFile(path.join(output, 'installation', project.slug, 'preview/install.webp')), {code: 'ENOENT'});
});
