import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {installationJobs, loadInstallationPage, WIDTH, HEIGHT, DURATION, FALLBACK_TIME} from '../render.mjs';

test('Package Manager captures show the correct package and complete channel URL at every stage and density', async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.ASPID_BANNER_BROWSER ? {executablePath: process.env.ASPID_BANNER_BROWSER} : {})});
  try {
    const sources = [
      {slug: 'aspid-collections', repository: 'VPDPersonal/Aspid.Collections', installation: true,
        stable: {packageId: 'tech.aspid.collections', packageName: 'Aspid.Collections', version: '1.1.1'}},
      {slug: 'aspid-fasttools', repository: 'VPDPersonal/Aspid.FastTools', installation: true,
        stable: {packageId: 'tech.aspid.fasttools', packageName: 'Aspid.FastTools', version: '1.0.0'},
        preview: {packageId: 'tech.aspid.fasttools', packageName: 'Aspid.FastTools', version: '2.0.0-preview.123'}},
      {slug: 'aspid-mvvm', repository: 'VPDPersonal/Aspid.MVVM', installation: true,
        stable: {version: '1.0.5', installation: false},
        preview: {packageId: 'tech.aspid.mvvm', packageName: 'Aspid.MVVM', version: '1.1.0-beta.1'}},
    ];
    for (const job of installationJobs(sources)) {
      for (const deviceScaleFactor of [1, 2]) {
        const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor});
        const errors = [];
        page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
        await loadInstallationPage(page, job);
        assert.equal(await page.locator('#typed').textContent(), job.url);
        const alignment = await page.locator('#typed').evaluate(element => {
          const text = element.getBoundingClientRect();
          const field = element.parentElement.getBoundingClientRect();
          return {verticalOffset: Math.abs((text.top + text.bottom - field.top - field.bottom) / 2), leftInset: text.left - field.left};
        });
        assert.ok(alignment.verticalOffset < 0.5, `${job.relative}: URL must be vertically centered in the input`);
        assert.ok(alignment.leftInset < 16, `${job.relative}: URL must start at the input's left padding`);
        const first = await page.screenshot();
        for (const [time, phase] of [[0, 0], [1800, 1], [FALLBACK_TIME, 2], [5000, 3], [6100, 4]]) {
          await page.evaluate(value => window.AspidInstallation.renderAt(value), time);
          assert.equal(await page.locator('#window').getAttribute('data-phase'), String(phase));
        }
        assert.equal(await page.locator('#name').textContent(), job.packageName);
        assert.equal(await page.locator('#package-id').textContent(), job.packageId);
        assert.equal(await page.locator('#version').textContent(), job.version);
        await page.evaluate(value => window.AspidInstallation.renderAt(value), FALLBACK_TIME + DURATION);
        // The animated WebP uses 1x captures; 2x covers the static PNG fallback and its text layout.
        if (deviceScaleFactor === 1) assert.ok(first.equals(await page.screenshot()), 'the WebP loop returns to identical captured pixels');
        assert.equal(await page.locator('#typed').textContent(), job.url);
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  } finally {await browser.close();}
});
