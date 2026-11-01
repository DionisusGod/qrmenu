import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApiMiddleware } from './server/apiMiddleware.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const apiMiddleware = createApiMiddleware();

function serveFile(res, filePath, isNoCache = false) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  if (isNoCache || ext === '.json' || ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  apiMiddleware(req, res, () => {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);

    // Always serve live data & uploads from public/ first so VDS changes are immediate
    if (cleanUrl.startsWith('/uploads/') || cleanUrl.startsWith('/data/') || cleanUrl.startsWith('/logos/') || cleanUrl.startsWith('/images/')) {
      const publicTarget = path.join(PUBLIC_DIR, cleanUrl);
      if (publicTarget.startsWith(PUBLIC_DIR) && fs.existsSync(publicTarget) && fs.statSync(publicTarget).isFile()) {
        return serveFile(res, publicTarget, cleanUrl.startsWith('/data/') || cleanUrl.startsWith('/uploads/'));
      }
    }

    // Serve built assets from dist/
    const baseDir = fs.existsSync(DIST_DIR) ? DIST_DIR : PUBLIC_DIR;
    const targetPath = path.join(baseDir, cleanUrl === '/' ? 'index.html' : cleanUrl);

    if (targetPath.startsWith(baseDir) && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      return serveFile(res, targetPath);
    }

    // SPA Fallback (/admin or any route -> index.html)
    const indexHtml = path.join(baseDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return serveFile(res, indexHtml, true);
    }

    res.statusCode = 404;
    res.end('Sayfa bulunamadı. Lütfen önce "npm run build" çalıştırın.');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dijital Menü VDS Sunucusu çalışıyor: http://localhost:${PORT}`);
  console.log(`🔐 Yönetim Paneli: http://localhost:${PORT}/#admin`);
});

