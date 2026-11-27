// A tiny static server for the demo and the pixel check. Local only (127.0.0.1).
//
//   node scripts/serve.mjs [--port 0] [--mount /prefix=/abs/dir ...]
//
// Serves this repo at /, plus any extra mounts. Prints "listening http://127.0.0.1:PORT" when ready.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };

const args = process.argv.slice(2);
let port = 0;
const mounts = [['/', fileURLToPath(new URL('..', import.meta.url))]];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i] === '--mount') { const [p, d] = args[++i].split('='); mounts.unshift([p.endsWith('/') ? p : p + '/', resolve(d)]); }
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [prefix, dir] = mounts.find(([p]) => path.startsWith(p));
    let file = normalize(join(dir, path.slice(prefix.length)));
    if (file !== dir && !file.startsWith(dir.endsWith(sep) ? dir : dir + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch (_) { res.writeHead(404).end('not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`listening http://127.0.0.1:${server.address().port}`));
