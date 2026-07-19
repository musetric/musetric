import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { type Plugin } from 'vite';

const backgroundColor = '#111111';

const renderPng = (svg: string, size: number): Buffer =>
  Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );

type FaviconsOptions = {
  svgPath: string;
  name: string;
};

type Asset = {
  source: Buffer | string;
  contentType: string;
};

const buildAssets = async (
  options: FaviconsOptions,
): Promise<Map<string, Asset>> => {
  const svg = readFileSync(options.svgPath, 'utf8');
  const ico = await pngToIco([16, 32, 48].map((size) => renderPng(svg, size)));
  const manifest = {
    name: options.name,
    short_name: options.name,
    icons: [
      {
        src: '/web-app-manifest-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    theme_color: backgroundColor,
    background_color: backgroundColor,
    display: 'standalone',
  };

  return new Map<string, Asset>([
    ['favicon.svg', { source: svg, contentType: 'image/svg+xml' }],
    ['favicon.ico', { source: ico, contentType: 'image/x-icon' }],
    [
      'favicon-96x96.png',
      { source: renderPng(svg, 96), contentType: 'image/png' },
    ],
    [
      'apple-touch-icon.png',
      { source: renderPng(svg, 180), contentType: 'image/png' },
    ],
    [
      'web-app-manifest-192x192.png',
      { source: renderPng(svg, 192), contentType: 'image/png' },
    ],
    [
      'web-app-manifest-512x512.png',
      { source: renderPng(svg, 512), contentType: 'image/png' },
    ],
    [
      'site.webmanifest',
      {
        source: `${JSON.stringify(manifest, undefined, 2)}\n`,
        contentType: 'application/manifest+json',
      },
    ],
  ]);
};

export const favicons = (options: FaviconsOptions): Plugin => ({
  name: 'musetric-favicons',
  writeBundle: async (bundleOptions) => {
    const assets = await buildAssets(options);
    const dir = bundleOptions.dir ?? 'dist';
    const writes = [...assets].map(async (entry) => {
      const [fileName, asset] = entry;
      await writeFile(join(dir, fileName), asset.source);
    });
    await Promise.all(writes);
  },
  configureServer: async (server) => {
    const assets = await buildAssets(options);
    server.middlewares.use((req, res, next) => {
      const { url = '' } = req;
      const [key = ''] = url.replace(/^\//, '').split('?');
      const asset = assets.get(key);
      if (!asset) {
        next();
        return;
      }
      res.setHeader('Content-Type', asset.contentType);
      res.end(asset.source);
    });
  },
});
