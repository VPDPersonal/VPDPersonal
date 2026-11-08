(() => {
  const duration = 7840;
  const title = document.querySelector('h1');
  const subtitle = document.querySelector('p');
  const canvas = document.querySelector('canvas');
  const glow = document.querySelector('#glow');
  const ratio = devicePixelRatio;
  canvas.width = 1280 * ratio;
  canvas.height = 384 * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  let seed = 2166136261;
  const random = () => {seed = Math.imul(seed ^ (seed >>> 15), 2246822519); return (seed >>> 0) / 4294967296;};
  const sparks = Array.from({length: 23}, () => ({x: random() * 1280, offset: random(), radius: 1 + random() * 1.5, drift: 8 + random() * 15}));

  function renderAt(milliseconds) {
    const time = ((milliseconds % duration) + duration) % duration / duration;
    context.clearRect(0, 0, 1280, 384);
    glow.style.opacity = String(.8 + .2 * Math.cos(time * Math.PI * 2));
    for (const spark of sparks) {
      const progress = (time + spark.offset) % 1;
      const fade = Math.sin(progress * Math.PI) ** 2;
      const x = spark.x + Math.sin(progress * Math.PI * 2) * spark.drift;
      const y = 420 - progress * 470;
      const radius = spark.radius;
      const halo = context.createRadialGradient(x, y, 0, x, y, radius * 5);
      halo.addColorStop(0, `rgba(92,180,107,${fade * .3})`);
      halo.addColorStop(1, 'rgba(92,180,107,0)');
      context.fillStyle = halo;
      context.fillRect(x - radius * 5, y - radius * 5, radius * 10, radius * 10);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(126,211,142,${fade * .65})`;
      context.fill();
    }
  }

  async function configure(config) {
    const prefix = config.title.startsWith('Aspid.') ? 'Aspid.' : '';
    title.querySelector('span').textContent = prefix;
    title.querySelector('b').textContent = config.title.slice(prefix.length);
    title.querySelector('b').style.fontWeight = 'inherit';
    subtitle.textContent = config.subtitle;
    await Promise.all([
      document.fonts.load('500 112px "Plex Serif"', config.title),
      document.fonts.load('500 42px "Plex Sans"', config.subtitle),
    ]);
    await document.fonts.ready;
    for (const [element, base] of [[title, 112], [subtitle, 42]]) {
      element.style.fontSize = `${base}px`;
      // Each project keeps the same logo and margins; long titles scale inside the available text column.
      const range = document.createRange();
      range.selectNodeContents(element);
      const width = range.getBoundingClientRect().width;
      if (width > 824) element.style.fontSize = `${Math.max(16, base * 824 / width)}px`;
    }
    await document.querySelector('#logo').decode();
    renderAt(0);
  }

  window.AspidBanner = {configure, renderAt, duration};
  window.ready = configure({title: 'Aspid.Library', subtitle: 'Tools for Unity and .NET'});
  if (!new URLSearchParams(location.search).has('capture')) {
    const start = performance.now();
    const tick = now => {renderAt(now - start); requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  }
})();
