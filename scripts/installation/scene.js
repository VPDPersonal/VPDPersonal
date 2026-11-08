(() => {
  const durations = [1300, 1400, 1800, 1100, 2600];
  const duration = durations.reduce((sum, value) => sum + value, 0);
  const element = id => document.getElementById(id);
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => 1 - (1 - clamp(value)) ** 3;
  let config;

  function renderAt(milliseconds) {
    let local = ((milliseconds % duration) + duration) % duration;
    let phase = 0;
    while (local >= durations[phase]) {local -= durations[phase]; phase++;}
    element('window').dataset.phase = String(phase);
    element('plus').toggleAttribute('data-press', phase === 1);
    element('menu').hidden = phase !== 1;
    element('menu').style.opacity = String(ease(local / 200));
    element('menu').style.transform = `translateY(${-4 * (1 - ease(local / 250))}px)`;
    element('git-item').toggleAttribute('data-hover', phase === 1 && local >= 450);
    element('popover').hidden = phase !== 2 && phase !== 3;
    element('popover').style.opacity = String(phase === 2 ? ease(local / 200) : 1);
    element('typed').textContent = config.url.slice(0, phase === 2 ? Math.floor(clamp((local - 150) / 1300) * config.url.length) : config.url.length);
    element('install').toggleAttribute('data-press', phase === 3);
    element('progress').style.transform = `scaleX(${phase === 3 ? ease((local - 100) / 900) : 0})`;
    const added = phase === 4 ? ease(local / 400) : 0;
    element('window').style.setProperty('--added', String(added));
    element('skeleton').hidden = phase === 4;
    for (const id of ['name', 'package-id', 'installed']) {element(id).hidden = phase !== 4; element(id).style.opacity = String(added);}
  }

  async function configure(value) {
    config = value;
    for (const id of ['list-name', 'name']) element(id).textContent = config.packageName;
    element('version').textContent = config.version;
    element('package-id').textContent = config.packageId;
    element('window').setAttribute('aria-label', `Package Manager installs ${config.packageName} from ${config.url}`);
    // Fit the complete channel URL before typing it, preserving the copyable URL's spelling in every frame.
    element('popover').hidden = false;
    element('typed').style.removeProperty('font-size');
    element('typed').textContent = config.url;
    const font = getComputedStyle(element('typed'));
    const fontSize = parseFloat(font.fontSize);
    await Promise.all([
      document.fonts.load(font.font, config.url),
      document.fonts.load(getComputedStyle(element('package-id')).font, config.packageId),
    ]);
    await document.fonts.ready;
    const width = element('typed').getBoundingClientRect().width;
    const available = (element('input').clientWidth - 12) * 2;
    if (width > available) element('typed').style.fontSize = `${fontSize * available / width}px`;
    renderAt(4300);
  }

  window.AspidInstallation = {configure, renderAt, duration, durations};
  window.ready = configure({packageName: 'Aspid.Example', packageId: 'tech.aspid.example', version: '1.0.0', url: 'https://github.com/VPDPersonal/Aspid.Example.git#upm'});
  if (!new URLSearchParams(location.search).has('capture')) {
    const start = performance.now();
    const tick = now => {renderAt(now - start); requestAnimationFrame(tick);};
    window.ready.then(() => requestAnimationFrame(tick));
  }
})();
