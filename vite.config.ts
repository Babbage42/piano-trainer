import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

// Mutopia n'autorise pas les pages d'autres sites à lire ses fichiers (pas d'en-têtes CORS) :
// le serveur de développement les récupère pour l'app. Une version hébergée aura besoin
// d'un relais équivalent.
const mutopiaProxy = {
  '/mutopia': {
    target: 'https://www.mutopiaproject.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/mutopia/, ''),
  },
};

// Le catalogue PDMX et ses fichiers MIDI restent dans .cache/pdmx (construits sur cette machine
// par scripts/build-pdmx-catalog.mjs, hors du dépôt) : le serveur les sert sous /pdmx/.
const PDMX_DIR = resolve(__dirname, '.cache/pdmx');

const servePdmx: Connect.NextHandleFunction = (req, res, next) => {
  const path = decodeURIComponent((req.url ?? '').split('?')[0]);
  if (path !== '/catalog.json' && !/^\/(mid|mxl)\/[\w/-]+\.(mid|mxl)$/.test(path)) return next();
  const file = resolve(PDMX_DIR, `.${path}`);
  if (!file.startsWith(PDMX_DIR + sep) || !existsSync(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const types: Record<string, string> = { json: 'application/json', mid: 'audio/midi', mxl: 'application/vnd.recordare.musicxml' };
  res.setHeader('Content-Type', types[path.split('.').pop()!]);
  res.end(readFileSync(file));
};

const pdmx: Plugin = {
  name: 'pdmx',
  configureServer: (server) => void server.middlewares.use('/pdmx', servePdmx),
  configurePreviewServer: (server) => void server.middlewares.use('/pdmx', servePdmx),
};

export default defineConfig({
  plugins: [pdmx],
  server: { proxy: mutopiaProxy },
  preview: { proxy: mutopiaProxy },
});
