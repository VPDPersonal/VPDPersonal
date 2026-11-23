import {readFile} from 'node:fs/promises';

export async function supportFiles() {
  const files = new Map();
  for (const [button, icon, mime] of [
    ['kofi-button.svg', 'kofi-cup.png', 'image/png'],
    ['unity-asset-store-button.svg', 'unity-mark.svg', 'image/svg+xml'],
  ]) {
    const artwork = await readFile(new URL(`icons/${icon}`, import.meta.url));
    const template = await readFile(new URL(`templates/${button}`, import.meta.url), 'utf8');
    // SVGs embedded as README images must carry their own icon data.
    files.set(icon, artwork);
    files.set(button, template.replace('{{icon}}', `data:${mime};base64,${artwork.toString('base64')}`));
  }
  return files;
}
