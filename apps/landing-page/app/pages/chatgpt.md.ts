// /chatgpt.md — raw-markdown twin of /chatgpt for agents that prefer
// text/markdown over HTML. Same build-time source: the canonical
// plugins/open-design/INSTALL.md at the repo root.

import type { APIRoute } from 'astro';
import installMd from '../../../../plugins/open-design/INSTALL.md?raw';

export const GET: APIRoute = () =>
  new Response(installMd, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
