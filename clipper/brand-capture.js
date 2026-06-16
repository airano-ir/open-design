// Open Design web clipper brand/design-system capture runtime.
//
// Injected on demand by the service worker. It does not clone the page. Instead
// it programmatically reads brand signals from the live DOM/CSSOM and fills a
// stable, reviewable design-system HTML template.

(function () {
  if (window.__odBrandCapture) return;

  const MAX_ELEMENTS = 1400;
  const MAX_IMAGES = 15;
  const MAX_LOGOS = 8;
  const MAX_RESOURCES = 120;
  const I18N = globalThis.OD_CLIPPER_I18N;
  let activeLocale = I18N?.currentLocale ? I18N.currentLocale() : 'en';

  function setActiveLocale(locale) {
    activeLocale = I18N?.normalizeLocale ? (I18N.normalizeLocale(locale) || activeLocale) : (locale || activeLocale);
  }

  function tr(key, vars) {
    return I18N?.t ? I18N.t(key, vars, activeLocale) : key;
  }

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeScriptJson(json) {
    return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  }

  function safeCss(value) {
    return String(value || '').replace(/<\/style/gi, '<\\/style');
  }

  function absUrl(url, base) {
    if (!url) return '';
    try {
      return new URL(url, base || document.baseURI).href;
    } catch {
      return '';
    }
  }

  function isHttp(url) {
    return /^https?:\/\//i.test(url || '');
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  function meta(name) {
    const selectors = [
      `meta[name="${name}"]`,
      `meta[property="${name}"]`,
      `meta[name="og:${name}"]`,
      `meta[property="og:${name}"]`,
      `meta[name="twitter:${name}"]`,
      `meta[property="twitter:${name}"]`,
    ];
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.getAttribute('content');
      if (text(value)) return text(value);
    }
    return '';
  }

  function parseRgb(value) {
    if (!value || value === 'transparent' || value === 'currentColor') return null;
    const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i.exec(value);
    if (rgba) {
      const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
      if (!Number.isFinite(a) || a <= 0.04) return null;
      return {
        r: Math.max(0, Math.min(255, Math.round(Number(rgba[1])))),
        g: Math.max(0, Math.min(255, Math.round(Number(rgba[2])))),
        b: Math.max(0, Math.min(255, Math.round(Number(rgba[3])))),
        a,
      };
    }
    const hex = /#([0-9a-f]{3,8})\b/i.exec(value);
    if (!hex) return null;
    let raw = hex[1];
    if (raw.length === 3 || raw.length === 4) raw = raw.split('').map((c) => c + c).join('');
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const a = raw.length >= 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    if (![r, g, b, a].every(Number.isFinite) || a <= 0.04) return null;
    return { r, g, b, a };
  }

  function hexOf(c) {
    const part = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${part(c.r)}${part(c.g)}${part(c.b)}`.toUpperCase();
  }

  function luminance(c) {
    const lin = (n) => {
      const v = n / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  }

  function saturation(c) {
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    return max === 0 ? 0 : (max - min) / max;
  }

  function contrastText(hex) {
    const c = parseRgb(hex);
    return c && luminance(c) < 0.48 ? '#FFFFFF' : '#111111';
  }

  function distinctColors(items, limit) {
    const out = [];
    for (const item of items) {
      const c = parseRgb(item.hex);
      if (!c) continue;
      const tooClose = out.some((existing) => {
        const e = parseRgb(existing.hex);
        if (!e) return false;
        return Math.abs(c.r - e.r) + Math.abs(c.g - e.g) + Math.abs(c.b - e.b) < 44;
      });
      if (!tooClose) out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  function visibleElements() {
    const out = [];
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (let i = 0; i < all.length && out.length < MAX_ELEMENTS; i += 1) {
      const el = all[i];
      if (!el || el.id?.startsWith('od-clipper-')) continue;
      let s;
      let r;
      try {
        s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
        r = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ el, style: s, rect: r });
    }
    return out;
  }

  function collectPalette(elements) {
    const scores = new Map();
    const add = (raw, score, role) => {
      const c = parseRgb(raw);
      if (!c) return;
      const hex = hexOf(c);
      const prev = scores.get(hex) || { hex, score: 0, roles: new Set(), c };
      prev.score += score;
      if (role) prev.roles.add(role);
      scores.set(hex, prev);
    };

    add(meta('theme-color'), 60, 'theme');
    add(getComputedStyle(document.documentElement).backgroundColor, 25, 'background');
    add(getComputedStyle(document.body || document.documentElement).backgroundColor, 40, 'background');
    add(getComputedStyle(document.body || document.documentElement).color, 40, 'foreground');

    const root = getComputedStyle(document.documentElement);
    for (let i = 0; i < root.length; i += 1) {
      const prop = root[i];
      if (!prop || !prop.startsWith('--')) continue;
      const lower = prop.toLowerCase();
      if (!/(color|bg|background|accent|brand|border|surface|foreground|text)/.test(lower)) continue;
      add(root.getPropertyValue(prop), 16, prop);
    }

    for (const item of elements) {
      const area = Math.min(40, Math.max(1, (item.rect.width * item.rect.height) / 6000));
      const tag = item.el.tagName.toLowerCase();
      const isControl = /^(a|button|input|select|textarea)$/.test(tag) || item.el.getAttribute('role') === 'button';
      add(item.style.backgroundColor, area + (isControl ? 24 : 0), isControl ? 'component-bg' : 'background');
      add(item.style.color, Math.min(18, text(item.el.textContent).length / 12) + (isControl ? 18 : 2), 'text');
      add(item.style.borderTopColor, isControl ? 10 : 3, 'border');
      add(item.style.outlineColor, 2, 'outline');
      add(item.style.fill, 4, 'svg-fill');
      add(item.style.stroke, 4, 'svg-stroke');
    }

    const ranked = [...scores.values()]
      .filter((item) => item.hex !== '#000000' || item.score > 8)
      .sort((a, b) => b.score - a.score);
    return distinctColors(ranked, 12).map((item) => ({
      hex: item.hex,
      score: Math.round(item.score),
      roles: [...item.roles].slice(0, 4),
      luminance: Number(luminance(item.c).toFixed(3)),
      saturation: Number(saturation(item.c).toFixed(3)),
    }));
  }

  function buildTheme(palette) {
    const parsed = palette.map((p) => ({ ...p, c: parseRgb(p.hex) })).filter((p) => p.c);
    const light = [...parsed].sort((a, b) => luminance(b.c) - luminance(a.c));
    const dark = [...parsed].sort((a, b) => luminance(a.c) - luminance(b.c));
    const saturated = [...parsed]
      .filter((p) => saturation(p.c) > 0.18 && luminance(p.c) > 0.12 && luminance(p.c) < 0.82)
      .sort((a, b) => b.score * saturation(b.c) - a.score * saturation(a.c));
    const neutral = [...parsed]
      .filter((p) => saturation(p.c) < 0.14)
      .sort((a, b) => b.score - a.score);
    const accent = saturated[0]?.hex || parsed[0]?.hex || '#C96442';
    const bg = light[0]?.hex || '#FFFFFF';
    const surface = light[1]?.hex || '#F7F7F5';
    const fg = dark[0]?.hex || '#111111';
    const muted = neutral.find((p) => luminance(p.c) > 0.18 && luminance(p.c) < 0.58)?.hex || '#666666';
    const border = neutral.find((p) => luminance(p.c) > 0.58 && luminance(p.c) < 0.9)?.hex || '#DDDDDD';
    const darkBg = dark[0]?.hex || '#111111';
    const darkSurface = dark[1]?.hex || '#1E1E1E';
    const darkFg = light[0]?.hex || '#FFFFFF';
    const darkMuted = neutral.find((p) => luminance(p.c) > 0.48 && luminance(p.c) < 0.82)?.hex || '#AAAAAA';
    return {
      light: { background: bg, surface, foreground: fg, muted, border, accent },
      dark: { background: darkBg, surface: darkSurface, foreground: darkFg, muted: darkMuted, border: muted, accent },
    };
  }

  function firstFamily(fontFamily) {
    return text(fontFamily).split(',')[0]?.replace(/["']/g, '').trim() || 'system-ui';
  }

  function fontSpecFor(selector, fallbackEl) {
    const el = document.querySelector(selector) || fallbackEl || document.body || document.documentElement;
    const s = getComputedStyle(el);
    return {
      selector,
      family: firstFamily(s.fontFamily),
      stack: s.fontFamily || 'system-ui',
      weight: s.fontWeight || '400',
      size: s.fontSize || '16px',
      lineHeight: s.lineHeight || 'normal',
      letterSpacing: s.letterSpacing || 'normal',
    };
  }

  function collectFontFaces(resources) {
    const faces = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (faces.length >= 8) break;
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const css = rule.cssText || '';
        css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (_m, ref) => {
          const url = absUrl(ref, sheet.href || document.baseURI);
          if (isHttp(url)) resources.add(url);
          return _m;
        });
        faces.push(css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
          const url = absUrl(ref, sheet.href || document.baseURI);
          return url ? `url(${q}${url}${q})` : m;
        }));
      }
    }
    return faces;
  }

  function collectTypography() {
    const specs = [
      { role: 'Display', ...fontSpecFor('h1, [class*="hero" i], [class*="title" i]') },
      { role: 'Body', ...fontSpecFor('body, p') },
      { role: 'UI', ...fontSpecFor('button, a, input, select') },
      { role: 'Mono', ...fontSpecFor('code, pre, kbd') },
    ];
    const familyScores = new Map();
    for (const el of Array.from(document.querySelectorAll('body, h1, h2, h3, p, a, button, input, code')).slice(0, 80)) {
      try {
        const s = getComputedStyle(el);
        const family = firstFamily(s.fontFamily);
        familyScores.set(family, (familyScores.get(family) || 0) + 1);
      } catch {
        // ignore
      }
    }
    return {
      specs,
      families: [...familyScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([family, count]) => ({ family, count })),
    };
  }

  function addCandidate(out, rawSrc, label, kind, score) {
    const src = absUrl(rawSrc);
    if (!isHttp(src) && !/^data:image\//i.test(src)) return;
    if (out.some((item) => item.src === src)) return;
    out.push({ src, label: text(label), kind, score });
  }

  function collectImageAssets(elements, resources) {
    const candidates = [];
    document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="mask-icon"]').forEach((link) => {
      addCandidate(candidates, link.getAttribute('href'), link.getAttribute('rel') || 'App icon', 'logo', 70);
    });
    addCandidate(candidates, meta('image'), 'Social preview image', 'image', 45);

    for (const img of Array.from(document.images)) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      const r = img.getBoundingClientRect();
      const area = Math.max(img.naturalWidth || r.width || 0, 1) * Math.max(img.naturalHeight || r.height || 0, 1);
      const hay = `${img.alt || ''} ${img.id || ''} ${img.className || ''} ${img.src || ''}`.toLowerCase();
      const logoish = /(logo|brand|mark|icon|wordmark)/.test(hay) || img.closest('header, nav');
      if (Math.max(img.naturalWidth || r.width || 0, img.naturalHeight || r.height || 0) < 32 && !logoish) continue;
      addCandidate(
        candidates,
        src,
        img.alt || (logoish ? 'Brand mark' : 'Page image'),
        logoish ? 'logo' : 'image',
        (logoish ? 75 : 20) + Math.min(30, area / 30000),
      );
    }

    for (const item of elements.slice(0, 900)) {
      const bg = item.style.backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      const match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(bg);
      if (!match) continue;
      const area = item.rect.width * item.rect.height;
      if (Math.max(item.rect.width, item.rect.height) < 64) continue;
      addCandidate(
        candidates,
        match[1],
        item.el.getAttribute('aria-label') || item.el.getAttribute('title') || 'Background image',
        'image',
        18 + Math.min(35, area / 30000),
      );
    }

    const sorted = candidates.sort((a, b) => b.score - a.score);
    const logos = sorted.filter((item) => item.kind === 'logo').slice(0, MAX_LOGOS);
    const images = sorted.filter((item) => item.kind !== 'logo').slice(0, MAX_IMAGES);
    for (const item of [...logos, ...images]) if (isHttp(item.src)) resources.add(item.src);
    return { logos, images };
  }

  function collectContent() {
    const title =
      meta('site_name') ||
      text(document.querySelector('h1')?.textContent) ||
      text(document.title) ||
      hostOf(location.href) ||
      tr('brandFallbackTitle');
    const description =
      meta('description') ||
      text(document.querySelector('main p, article p, [class*="subtitle" i], [class*="description" i]')?.textContent) ||
      tr('brandFallbackDescription');
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((el) => text(el.textContent))
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 8);
    const keywords = [
      ...text(meta('keywords')).split(',').map((s) => text(s)).filter(Boolean),
      ...headings.slice(0, 4),
    ].slice(0, 8);
    return {
      title,
      description,
      domain: hostOf(location.href),
      url: location.href,
      documentTitle: text(document.title),
      headings,
      keywords,
    };
  }

  function collectComponents() {
    const s = (selector, fallback) => {
      const el = document.querySelector(selector);
      if (!el) return fallback;
      const cs = getComputedStyle(el);
      return {
        background: cs.backgroundColor,
        color: cs.color,
        border: cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        font: cs.fontFamily,
      };
    };
    return {
      button: s('button, a[role="button"], input[type="submit"], .btn, [class*="button" i]', {}),
      input: s('input, textarea, select, [contenteditable="true"]', {}),
      card: s('article, section, .card, [class*="card" i], [class*="panel" i]', {}),
      nav: s('nav, header', {}),
    };
  }

  function swatchName(index, color, role) {
    const names = [
      tr('swatchBackground'),
      tr('swatchSurface'),
      tr('swatchForeground'),
      tr('swatchMuted'),
      tr('swatchBorder'),
      tr('swatchAccent'),
      tr('swatchSupport'),
      tr('swatchHighlight'),
    ];
    return role || names[index] || tr('swatchColor', { index: index + 1 });
  }

  function renderHtml(data, fontFaces) {
    const palette = data.palette.length ? data.palette : [
      { hex: '#FFFFFF', roles: ['background'] },
      { hex: '#111111', roles: ['foreground'] },
      { hex: '#C96442', roles: ['accent'] },
    ];
    const light = data.theme.light;
    const dark = data.theme.dark;
    const logo = data.assets.logos[0];
    const fontCss = fontFaces.length ? `${fontFaces.join('\n')}\n` : '';
    const logoHtml = data.assets.logos.length
      ? data.assets.logos.map((item) => `
        <figure class="asset-card logo-card">
          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.label || tr('brandAssetAlt'))}" />
          <figcaption>${escapeHtml(item.label || tr('brandLogoAsset'))}</figcaption>
        </figure>`).join('')
      : `<div class="empty-card">${escapeHtml(data.content.title.slice(0, 1).toUpperCase())}</div>`;
    const imagesHtml = data.assets.images.length
      ? data.assets.images.map((item, i) => `
        <figure class="asset-card image-card">
          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.label || tr('brandImageAlt', { index: i + 1 }))}" />
          <figcaption>${escapeHtml(item.label || tr('brandImageLabel', { index: i + 1 }))}</figcaption>
        </figure>`).join('')
      : `<div class="empty-note">${escapeHtml(tr('brandNoImages'))}</div>`;
    const paletteHtml = palette.map((item, i) => {
      const role = item.roles?.[0] ? String(item.roles[0]).replace(/^--/, '') : '';
      return `
        <article class="swatch">
          <div class="swatch-color" style="background:${escapeHtml(item.hex)};color:${contrastText(item.hex)}">${escapeHtml(item.hex)}</div>
          <div class="swatch-body">
            <strong>${escapeHtml(swatchName(i, item.hex, role))}</strong>
            <span>${escapeHtml((item.roles || []).join(' / ') || tr('brandObservedColor'))}</span>
          </div>
        </article>`;
    }).join('');
    const typeHtml = data.typography.specs.map((spec) => `
      <article class="type-card">
        <span>${escapeHtml(spec.role)}</span>
        <strong style="font-family:${escapeHtml(spec.stack)};font-weight:${escapeHtml(spec.weight)}">Ag</strong>
        <small>${escapeHtml(spec.family)} · ${escapeHtml(spec.weight)} · ${escapeHtml(spec.size)}</small>
      </article>`).join('');
    const headingsHtml = data.content.headings.length
      ? data.content.headings.map((h) => `<li>${escapeHtml(h)}</li>`).join('')
      : `<li>${escapeHtml(tr('brandNoHeading'))}</li>`;
    const keywordHtml = data.content.keywords.length
      ? data.content.keywords.map((k) => `<span>${escapeHtml(k)}</span>`).join('')
      : `<span>${escapeHtml(tr('brandKeywordFallback'))}</span>`;
    const json = escapeScriptJson(JSON.stringify(data, null, 2));
    const htmlLocale = I18N?.htmlLang ? I18N.htmlLang(activeLocale) : activeLocale;
    const dir = I18N?.isRtl && I18N.isRtl(activeLocale) ? 'rtl' : 'ltr';

    return `<!doctype html>
<html lang="${escapeHtml(htmlLocale)}" dir="${escapeHtml(dir)}" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.content.title)} — ${escapeHtml(tr('brandPageTitleSuffix'))}</title>
    <meta name="od-library-kind" content="design-system" />
    <style>
      ${safeCss(fontCss)}
      :root {
        color-scheme: light dark;
        --bg: ${light.background};
        --surface: ${light.surface};
        --text: ${light.foreground};
        --muted: ${light.muted};
        --border: ${light.border};
        --accent: ${light.accent};
        --on-accent: ${contrastText(light.accent)};
        --font-display: ${data.typography.specs[0]?.stack || 'ui-serif, Georgia, serif'};
        --font-body: ${data.typography.specs[1]?.stack || 'system-ui, sans-serif'};
        --font-ui: ${data.typography.specs[2]?.stack || 'system-ui, sans-serif'};
        --font-mono: ${data.typography.specs[3]?.stack || 'ui-monospace, SFMono-Regular, monospace'};
      }
      html[data-theme="dark"] {
        --bg: ${dark.background};
        --surface: ${dark.surface};
        --text: ${dark.foreground};
        --muted: ${dark.muted};
        --border: ${dark.border};
        --accent: ${dark.accent};
        --on-accent: ${contrastText(dark.accent)};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: var(--font-body);
        background: var(--bg);
        color: var(--text);
        line-height: 1.55;
      }
      a { color: inherit; }
      .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 36px 0 56px; }
      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 28px;
        align-items: start;
        padding-bottom: 28px;
        border-bottom: 1px solid var(--border);
      }
      .brand-lockup { display: flex; align-items: center; gap: 16px; min-width: 0; }
      .brand-mark {
        width: 72px; height: 72px; display: grid; place-items: center; flex: none;
        border: 1px solid var(--border); border-radius: 18px; background: var(--surface); overflow: hidden;
      }
      .brand-mark img { max-width: 82%; max-height: 82%; object-fit: contain; }
      .brand-fallback { font: 700 32px/1 var(--font-display); color: var(--accent); }
      h1 { margin: 0; font: 700 clamp(34px, 6vw, 68px)/1.02 var(--font-display); }
      .domain { margin: 8px 0 0; color: var(--muted); font: 600 13px/1.4 var(--font-ui); }
      .description { max-width: 76ch; margin: 20px 0 0; color: var(--muted); font-size: 17px; }
      .theme-toggle { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); }
      .theme-toggle button { border: 0; border-radius: 999px; padding: 7px 12px; background: transparent; color: var(--muted); font: 700 12px/1 var(--font-ui); cursor: pointer; }
      html[data-theme="light"] [data-theme-button="light"],
      html[data-theme="dark"] [data-theme-button="dark"] { background: var(--accent); color: var(--on-accent); }
      .section { padding: 30px 0; border-bottom: 1px solid var(--border); }
      .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
      h2 { margin: 0; font: 700 22px/1.2 var(--font-display); }
      .eyebrow { color: var(--muted); font: 700 11px/1.2 var(--font-ui); text-transform: uppercase; letter-spacing: 0.08em; }
      .asset-types { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
      .asset-type, .type-card, .swatch, .kit-card, .asset-card, .identity, .component-preview {
        border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
      }
      .asset-type { padding: 13px; min-height: 92px; }
      .asset-type strong { display: block; margin-bottom: 5px; font: 700 13px/1.3 var(--font-ui); }
      .asset-type span { color: var(--muted); font-size: 12px; }
      .identity { padding: 20px 22px; }
      .identity p { margin: 0; color: var(--muted); font-size: 16px; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      .chips span { padding: 4px 9px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: color-mix(in srgb, var(--surface) 70%, var(--bg)); font: 600 12px/1.4 var(--font-ui); }
      .logo-grid, .image-grid, .palette-grid, .type-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
      .asset-card { overflow: hidden; }
      .asset-card img { width: 100%; height: 142px; object-fit: contain; display: block; background: color-mix(in srgb, var(--surface) 70%, var(--bg)); }
      .image-card img { object-fit: cover; }
      .asset-card figcaption { padding: 10px 12px; color: var(--muted); font: 600 12px/1.35 var(--font-ui); }
      .empty-card { min-height: 142px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 10px; color: var(--accent); font: 800 42px/1 var(--font-display); }
      .empty-note { color: var(--muted); border: 1px dashed var(--border); border-radius: 10px; padding: 24px; }
      .swatch { overflow: hidden; }
      .swatch-color { min-height: 84px; display: flex; align-items: flex-end; padding: 12px; font: 800 13px/1 var(--font-ui); }
      .swatch-body { padding: 12px; display: flex; flex-direction: column; gap: 3px; }
      .swatch-body span, .type-card small { color: var(--muted); font-size: 12px; }
      .type-card { padding: 16px; min-height: 164px; display: flex; flex-direction: column; justify-content: space-between; }
      .type-card span { color: var(--muted); font: 700 11px/1.2 var(--font-ui); text-transform: uppercase; }
      .type-card strong { font-size: 62px; line-height: 1; }
      .component-preview { padding: 22px; display: grid; gap: 16px; }
      .kit-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 15px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); font: 700 13px/1 var(--font-ui); }
      .btn.secondary { background: transparent; color: var(--text); border-color: var(--border); }
      .field { min-height: 40px; min-width: 220px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: 500 14px/1 var(--font-ui); }
      .mini-card { padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); min-width: 240px; }
      .mini-card strong { display: block; margin-bottom: 4px; }
      .mini-card span { color: var(--muted); font-size: 13px; }
      .headings { margin: 0; padding-left: 20px; color: var(--muted); }
      .headings li + li { margin-top: 5px; }
      .data-note { color: var(--muted); font-size: 12px; }
      @media (max-width: 860px) {
        .shell { width: min(100% - 28px, 1180px); padding-top: 24px; }
        .hero { grid-template-columns: 1fr; }
        .asset-types { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="hero">
        <div>
          <div class="brand-lockup">
            <div class="brand-mark">
              ${logo ? `<img src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.label || data.content.title)}" />` : `<span class="brand-fallback">${escapeHtml(data.content.title.slice(0, 1).toUpperCase())}</span>`}
            </div>
            <div>
              <p class="eyebrow">${escapeHtml(tr('brandExtracted'))}</p>
              <h1>${escapeHtml(data.content.title)}</h1>
              <p class="domain">${escapeHtml(data.content.domain || data.content.url)}</p>
            </div>
          </div>
          <p class="description">${escapeHtml(data.content.description)}</p>
        </div>
        <div class="theme-toggle" aria-label="${escapeHtml(tr('brandTheme'))}">
          <button type="button" data-theme-button="light">${escapeHtml(tr('brandLight'))}</button>
          <button type="button" data-theme-button="dark">${escapeHtml(tr('brandDark'))}</button>
        </div>
      </header>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandAssetMap'))}</h2><span class="eyebrow">${escapeHtml(tr('brandAssetMapSub'))}</span></div>
        <div class="asset-types">
          <article class="asset-type"><strong>${escapeHtml(tr('brandLogo'))}</strong><span>${escapeHtml(tr('brandLogoCount', { count: data.assets.logos.length }))}</span></article>
          <article class="asset-type"><strong>${escapeHtml(tr('brandImages'))}</strong><span>${escapeHtml(tr('brandImageCount', { count: data.assets.images.length }))}</span></article>
          <article class="asset-type"><strong>${escapeHtml(tr('brandTypography'))}</strong><span>${escapeHtml(tr('brandFontCount', { count: data.typography.families.length }))}</span></article>
          <article class="asset-type"><strong>${escapeHtml(tr('brandPalette'))}</strong><span>${escapeHtml(tr('brandColorCount', { count: palette.length }))}</span></article>
          <article class="asset-type"><strong>${escapeHtml(tr('brandVoice'))}</strong><span>${escapeHtml(tr('brandHeadingCount', { count: data.content.headings.length }))}</span></article>
          <article class="asset-type"><strong>${escapeHtml(tr('brandComponents'))}</strong><span>${escapeHtml(tr('brandComponentSummary'))}</span></article>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandIdentity'))}</h2><span class="eyebrow">${escapeHtml(data.content.documentTitle || data.content.domain)}</span></div>
        <div class="identity">
          <p>${escapeHtml(data.content.description)}</p>
          <div class="chips">${keywordHtml}</div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandLogo'))}</h2><span class="eyebrow">${escapeHtml(tr('brandLogoSub'))}</span></div>
        <div class="logo-grid">${logoHtml}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandTypography'))}</h2><span class="eyebrow">${escapeHtml(tr('brandTypographySub'))}</span></div>
        <div class="type-grid">${typeHtml}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandPalette'))}</h2><span class="eyebrow">${escapeHtml(tr('brandPaletteSub'))}</span></div>
        <div class="palette-grid">${paletteHtml}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandComponentKit'))}</h2><span class="eyebrow">${escapeHtml(tr('brandComponentKitSub'))}</span></div>
        <div class="component-preview">
          <div class="kit-row">
            <span class="btn">${escapeHtml(tr('brandPrimaryAction'))}</span>
            <span class="btn secondary">${escapeHtml(tr('brandSecondaryAction'))}</span>
            <input class="field" value="${escapeHtml(tr('brandFormField'))}" aria-label="${escapeHtml(tr('brandFormFieldSample'))}" />
          </div>
          <div class="kit-row">
            <article class="mini-card"><strong>${escapeHtml(tr('brandSurfaceCard'))}</strong><span>${escapeHtml(tr('brandSurfaceCardText'))}</span></article>
            <article class="mini-card"><strong>${escapeHtml(tr('brandNavigationItem'))}</strong><span>${escapeHtml(data.content.headings[0] || tr('brandIdentity'))}</span></article>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandImages'))}</h2><span class="eyebrow">${escapeHtml(tr('brandImagesSub'))}</span></div>
        <div class="image-grid">${imagesHtml}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${escapeHtml(tr('brandVoiceContent'))}</h2><span class="eyebrow">${escapeHtml(tr('brandVoiceContentSub'))}</span></div>
        <ol class="headings">${headingsHtml}</ol>
      </section>

      <p class="data-note">${tr('brandDataNote')}</p>
    </main>
    <script type="application/json" id="od-design-system-data">${json}</script>
    <script>
      document.querySelectorAll('[data-theme-button]').forEach(function (button) {
        button.addEventListener('click', function () {
          document.documentElement.dataset.theme = button.dataset.themeButton || 'light';
        });
      });
    </script>
  </body>
</html>`;
  }

  window.__odBrandCapture = function (opts) {
    setActiveLocale(opts && opts.locale);
    const resources = new Set();
    const elements = visibleElements();
    const content = collectContent();
    const palette = collectPalette(elements);
    const theme = buildTheme(palette);
    const typography = collectTypography();
    const fontFaces = collectFontFaces(resources);
    const assets = collectImageAssets(elements, resources);
    const components = collectComponents();
    const data = {
      version: 1,
      kind: 'design-system',
      capturedAt: Date.now(),
      content,
      theme,
      palette,
      typography,
      assets,
      components,
    };
    return {
      html: renderHtml(data, fontFaces),
      resources: Array.from(resources).filter(isHttp).slice(0, MAX_RESOURCES),
      title: tr('brandFileTitle', { title: content.title }),
      url: location.href,
      summary: {
        colors: palette.length,
        logos: assets.logos.length,
        images: assets.images.length,
        fonts: typography.families.length,
      },
    };
  };
})();
