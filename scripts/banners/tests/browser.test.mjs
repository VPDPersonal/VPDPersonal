import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {loadBannerPage, WIDTH, HEIGHT} from '../render.mjs';

test('file-based banner captures include a visible, animated glow without resource errors', async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.ASPID_BANNER_BROWSER ? {executablePath: process.env.ASPID_BANNER_BROWSER} : {})});
  try {
    const projects = JSON.parse(await readFile(new URL('../../badges/projects.json', import.meta.url), 'utf8'));
    for (const project of projects.filter(project => project.banner)) {
      for (const deviceScaleFactor of [1, 2]) {
        const page = await browser.newPage({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor});
        const errors = [];
        page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
        await loadBannerPage(page, project.banner);
        const visible = await page.screenshot();
        await page.locator('#glow').evaluate(element => {element.style.visibility = 'hidden';});
        const hidden = await page.screenshot();
        assert.ok(!visible.equals(hidden), `${project.slug} at ${deviceScaleFactor}x: glow must affect captured pixels`);
        await page.locator('#glow').evaluate(element => {element.style.visibility = 'visible';});
        await page.locator('canvas').evaluate(element => {element.style.visibility = 'hidden';});
        const bright = await page.screenshot();
        await page.evaluate(() => window.AspidBanner.renderAt(window.AspidBanner.duration / 2));
        const dim = await page.screenshot();
        assert.ok(!bright.equals(dim), `${project.slug} at ${deviceScaleFactor}x: glow must pulse independently of sparks`);
        assert.deepEqual(errors, [], `${project.slug}: browser console errors`);
        await page.close();
      }
    }
  } finally {await browser.close();}
});
