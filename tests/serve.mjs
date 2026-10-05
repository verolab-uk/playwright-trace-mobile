// Serves the built viewer from dist/ and recorded traces from tests/.traces/,
// the same way a Playwright HTML report serves trace/ next to data/.
import fs from 'fs';
import http from 'http';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const mounts = [['/traces/', path.join(root, 'tests/.traces')], ['/', path.join(root, 'dist')]];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const [prefix, dir] = mounts.find(([p]) => url.pathname.startsWith(p));
  const file = path.join(dir, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT ?? 4173));
