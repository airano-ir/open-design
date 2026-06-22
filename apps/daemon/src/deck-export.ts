import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as PptxGenJSModule from 'pptxgenjs';
import type { DesktopRenderSlidesInput } from '@open-design/sidecar-proto';

// pptxgenjs ships a default-export class, but its NodeNext typings resolve the
// default to the module namespace (no construct signature). At runtime the ESM
// build's default IS the class, so reach it and re-type as a constructor.
type PptxInstance = InstanceType<typeof import('pptxgenjs').default>;
const PptxGenJS = PptxGenJSModule.default as unknown as { new (): PptxInstance };

import { readProjectFile } from './projects.js';

export interface BuildDeckRenderInputOptions {
  daemonUrl: string;
  fileName: string;
  index?: number;
  // Directory the desktop renderer writes the rendered images into (returned as
  // file paths) instead of base64 data URLs — keeps large images off the IPC.
  outputDir?: string;
  pageImageFormat?: 'png' | 'jpeg';
  projectId: string;
  projectsRoot: string;
  scale?: number;
  stitch?: boolean;
  title?: string;
}

export interface DeckRenderRequest {
  defaultFilename: string;
  input: DesktopRenderSlidesInput;
  title: string;
}

/**
 * Reads a deck HTML file and prepares the {@link DesktopRenderSlidesInput} the
 * desktop renderer needs. Mirrors {@link buildDesktopPdfExportInput} in
 * pdf-export.ts: same `<base href>` derivation so the rendered deck resolves
 * its relative CSS/JS/image assets through the daemon's `/raw/` route.
 */
export async function buildDeckRenderInput(
  options: BuildDeckRenderInputOptions,
): Promise<DeckRenderRequest> {
  const file = await readProjectFile(options.projectsRoot, options.projectId, options.fileName);
  const title = displayTitle(options.title, options.fileName);
  return {
    defaultFilename: `${safeFilename(title, 'deck')}`,
    title,
    input: {
      baseHref: rawBaseHref(options.daemonUrl, options.projectId, options.fileName),
      html: file.buffer.toString('utf8'),
      ...(options.index == null ? {} : { index: options.index }),
      ...(options.outputDir == null ? {} : { outputDir: options.outputDir }),
      ...(options.pageImageFormat == null ? {} : { pageImageFormat: options.pageImageFormat }),
      ...(options.scale == null ? {} : { scale: options.scale }),
      ...(options.stitch == null ? {} : { stitch: options.stitch }),
    },
  };
}

export interface SlideImage {
  buffer: Buffer;
  jpeg: boolean;
}

/**
 * Decodes the `data:image/(png|jpeg);base64,...` URLs the desktop renderer
 * returns into raw image buffers tagged with their format. Rejects anything that
 * is not a base64 PNG/JPEG data URL so a malformed renderer response surfaces as
 * an export failure rather than a corrupt file.
 */
/**
 * Reads the image files the desktop renderer wrote (the `outputDir` handoff)
 * into raw buffers tagged with their format (by extension). The companion to
 * {@link decodeSlideDataUrls} for the file-path path, which avoids shuttling
 * base64 image bytes through the JSON IPC channel for large images.
 */
export async function readSlideFiles(paths: string[]): Promise<SlideImage[]> {
  return Promise.all(
    paths.map(async (filePath, index) => {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        throw new Error(`slide ${index + 1} has no file path`);
      }
      const buffer = await readFile(filePath);
      return { buffer, jpeg: /\.jpe?g$/i.test(filePath) };
    }),
  );
}

export function decodeSlideDataUrls(urls: string[]): SlideImage[] {
  return urls.map((url, index) => {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(url ?? '');
    if (!match) {
      throw new Error(`slide ${index + 1} is not a base64 PNG/JPEG data URL`);
    }
    return { buffer: Buffer.from(match[2] ?? '', 'base64'), jpeg: match[1] === 'jpeg' };
  });
}

/**
 * Assembles per-slide images into a screenshot-based .pptx — one full-bleed
 * image per 16:9 slide. The slides are pixel-perfect images (not editable text),
 * the "exactly what you see" export mode. Returns the .pptx bytes.
 */
export async function buildScreenshotPptx(
  images: SlideImage[],
  opts: { title?: string } = {},
): Promise<Buffer> {
  if (images.length === 0) throw new Error('no slides to export');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Open Design';
  if (opts.title) pptx.title = opts.title;
  pptx.subject = 'Screenshot-based PPTX';
  for (const img of images) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: `data:image/${img.jpeg ? 'jpeg' : 'png'};base64,${img.buffer.toString('base64')}`,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%',
    });
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

/**
 * Assembles per-slide images into a screenshot-based .pdf — one page per slide,
 * each page sized to its image. Pixel-perfect, raster (not selectable text).
 * Full pages render as JPEG (small); deck slides as PNG (crisp).
 */
export async function buildScreenshotPdf(images: SlideImage[]): Promise<Buffer> {
  if (images.length === 0) throw new Error('no slides to export');
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const image = img.jpeg ? await pdf.embedJpg(img.buffer) : await pdf.embedPng(img.buffer);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function displayTitle(title: string | undefined, fileName: string): string {
  if (typeof title === 'string' && title.trim().length > 0) return title.trim();
  const base = path.posix.basename(fileName);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || 'deck';
}

function rawBaseHref(daemonUrl: string, projectId: string, fileName: string): string {
  const dir = path.posix.dirname(fileName.replace(/^\/+/, ''));
  const safeProjectId = encodeURIComponent(projectId);
  const rawBase = `${daemonUrl.replace(/\/+$/, '')}/api/projects/${safeProjectId}/raw/`;
  if (!dir || dir === '.') return rawBase;
  return `${rawBase}${encodePathSegments(dir)}/`;
}

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safeFilename(name: string, fallback: string): string {
  const slug = (name || fallback)
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
