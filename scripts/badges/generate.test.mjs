import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchProject, generatedFiles, releaseData, renderBadge} from './generate.mjs';

const project = {slug: 'aspid-example', repository: 'VPDPersonal/Aspid.Example', manifests: ['Package/package.json', 'package.json']};
const release = (tag, prerelease = false, date = '2026-11-01T12:00:00Z') => ({
  tag_name: tag, prerelease, draft: false, published_at: date,
});
const manifest = (version = '1.2.3') => ({version, unity: '2021.3', unityRelease: '0f1', license: 'MIT'});
const content = (value) => ({type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64')});

test('a release uses the complete Unity minimum and agrees with its manifest', () => {
  assert.deepEqual(releaseData(release('v1.2.3'), manifest()), {
    tag: 'v1.2.3', version: '1.2.3', unity: '2021.3.0f1', license: 'MIT',
  });
  assert.equal(releaseData(release('v1.2.3'), {...manifest(), unityRelease: undefined}).unity, '2021.3');
  assert.throws(() => releaseData(release('v1.2.4'), manifest()), /disagrees/);
  assert.throws(() => releaseData(release('v1.2.3-rc.1', false), manifest('1.2.3-rc.1')), /channel/);
  assert.throws(() => releaseData(release('v1.2.3'), {...manifest(), license: 'Apache-2.0'}), /license/);
  assert.throws(() => releaseData(release('v1.2.3'), {...manifest(), unityRelease: '<script>'}), /Unity/);
});

test('the latest stable and published preview are selected independently, across pages and package moves', async () => {
  const stable = release('v1.2.3');
  const draft = {...release('v99.0.0-rc.1', true, '2027-01-01T00:00:00Z'), draft: true};
  const older = release('v1.3.0-rc.1', true, '2026-10-01T00:00:00Z');
  const newer = release('v1.3.0-rc.2', true, '2026-10-10T00:00:00Z');
  const requests = [];
  const result = await fetchProject(project, async (url) => {
    requests.push(url);
    if (url.endsWith('/releases/latest')) return stable;
    if (url.endsWith('page=1')) return [draft, older, ...Array(98).fill(stable)];
    if (url.endsWith('page=2')) return [newer];
    if (url.includes('/contents/Package/')) return null;
    if (url.includes('ref=v1.2.3')) return content(manifest());
    if (url.includes('ref=v1.3.0-rc.2')) return content(manifest('1.3.0-rc.2'));
    throw new Error(`Unexpected request ${url}`);
  });
  assert.equal(result.stable.version, '1.2.3');
  assert.equal(result.preview.version, '1.3.0-rc.2');
  assert.ok(requests.every((url) => !url.includes('ref=main')));
});

test('a preview-only project works without advertising a stable release', async () => {
  const result = await fetchProject(project, async (url) => {
    if (url.endsWith('/releases/latest')) return null;
    if (url.includes('/releases?')) return [release('v1.0.0-beta.1', true)];
    return content(manifest('1.0.0-beta.1'));
  });
  assert.equal(result.stable, null);
  const files = await generatedFiles([result]);
  assert.equal(files.has('aspid-example/status-badge-release.svg'), false);
  assert.ok(files.has('aspid-example/preview/status-badge-unity.svg'));
  assert.match(files.get('aspid-example/status-badge-preview.svg'), /Preview 1.0.0-beta.1/);
});

test('an API outage or a missing published manifest fails instead of substituting development data', async () => {
  await assert.rejects(fetchProject(project, async () => {throw new Error('GitHub 503');}), /503/);
  await assert.rejects(fetchProject(project, async (url) => {
    if (url.endsWith('/releases/latest')) return release('v1.2.3');
    if (url.includes('/releases?')) return [];
    return null;
  }), /No package manifest/);
  await assert.rejects(fetchProject({...project, slug: '../outside'}), /configuration/);
});

test('long versions fit and the SVG retains both themes with escaped accessible text', async () => {
  const short = await renderBadge('preview', '1.0.0');
  const long = await renderBadge('preview', '123.456.789-preview.12345');
  const width = (svg) => Number(svg.match(/width="(\d+)"/)[1]);
  assert.ok(width(long) > width(short) + 100);
  assert.match(long, /prefers-color-scheme: dark/);
  assert.match(long, /<text class="gold"[^>]*>Preview<\/text>/);
  assert.equal(long.includes('{{'), false);
  const escaped = await renderBadge('unity', '2021.3<&"');
  assert.match(escaped, /aria-label="Unity 2021.3&lt;&amp;&quot;\+"/);
  assert.match(await renderBadge('release', '1.2.3'), /class="anchor"/);
});

test('unchanged source values produce byte-identical output and share one license badge', async () => {
  const sources = [{...project, stable: releaseData(release('v1.2.3'), manifest()), preview: null}];
  assert.deepEqual(await generatedFiles(sources), await generatedFiles(sources));
  const files = await generatedFiles(sources);
  assert.equal(files.size, 3);
  assert.match(files.get('status-badge-license.svg'), /MIT License/);
});
