import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const headerPath = new URL('../app/_components/header.tsx', import.meta.url);
const enhancerPath = new URL('../app/_components/header-enhancer.astro', import.meta.url);
const homePagePath = new URL('../app/pages/index.astro', import.meta.url);
const downloadPagePath = new URL('../app/pages/download/index.astro', import.meta.url);
const infoCopyPath = new URL('../app/info-page-i18n.ts', import.meta.url);

describe('landing header account and download entry', () => {
  it('keeps the nav download-page CTA and removes the signed-out login entry', async () => {
    const header = await readFile(headerPath, 'utf8');

    assert.match(header, /href=\{href\('\/download\/'\)\}/);
    assert.match(header, /data-download-placement='nav'/);
    assert.doesNotMatch(header, /data-amr-signin|className='nav-signin'/);
    assert.match(header, /data-amr-menu hidden/);
    assert.match(header, /data-amr-console-link/);
  });

  it('silently reveals the avatar for an existing session without wiring login', async () => {
    const enhancer = await readFile(enhancerPath, 'utf8');
    const homePage = await readFile(homePagePath, 'utf8');

    for (const source of [enhancer, homePage]) {
      assert.match(source, /fetchSession\(\)\.then\(\(user\) =>/);
      assert.match(source, /if \(user\) showSignedIn\(user\)/);
      assert.doesNotMatch(source, /sign_in_click|data-amr-signin|od-cloud-login|window\.open\(/);
    }
  });
});

describe('mobile download-page guidance', () => {
  it('shows a desktop-download notice only after mobile-device detection', async () => {
    const page = await readFile(downloadPagePath, 'utf8');
    const copy = await readFile(infoCopyPath, 'utf8');

    assert.match(page, /data-dl-mobile-notice hidden/);
    assert.match(page, /android\|iphone\|ipad\|ipod\|mobile/);
    assert.match(page, /matchMedia\('\(max-width: 767px\)'\)\.matches/);
    assert.match(page, /if \(isMobile && mobileNotice\) mobileNotice\.hidden = false/);
    assert.match(copy, /Open Design 是桌面客户端，请在电脑上下载。/);
  });
});
