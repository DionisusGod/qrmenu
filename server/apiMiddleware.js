import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const AUTH_FILE = path.join(ROOT_DIR, '.admin-auth.json');
const MENU_FILE = path.join(ROOT_DIR, 'public', 'data', 'menu.json');
const DIST_MENU_FILE = path.join(ROOT_DIR, 'dist', 'data', 'menu.json');
const UPLOADS_DIR = path.join(ROOT_DIR, 'public', 'uploads');
const DIST_UPLOADS_DIR = path.join(ROOT_DIR, 'dist', 'uploads');

// Brute-force protection (IP -> { count, resetAt })
const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function ensureAuthConfig() {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      if (parsed.salt && parsed.hash && parsed.hmacSecret) {
        return parsed;
      }
    } catch {
      // Fall through and recreate if corrupted
    }
  }

  const initialPassword = process.env.ADMIN_PASSWORD || '1234';
  const salt = crypto.randomBytes(16).toString('hex');
  const hmacSecret = crypto.randomBytes(32).toString('hex');
  const hash = hashPassword(initialPassword, salt);

  const config = {
    algorithm: 'scrypt-64',
    salt,
    hash,
    hmacSecret,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(AUTH_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

function verifyPasswordConstantTime(password, authConfig) {
  const candidateHex = hashPassword(password, authConfig.salt);
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(authConfig.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSignedToken(hmacSecret) {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      iat: Date.now(),
      exp: Date.now() + TOKEN_TTL_MS
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', Buffer.from(hmacSecret, 'hex'))
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verifySignedToken(token, hmacSecret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expectedSig = crypto
    .createHmac('sha256', Buffer.from(hmacSecret, 'hex'))
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Dosya boyutu çok büyük (Maksimum 12MB).'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Geçersiz JSON verisi.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf-8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', payload.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

export function createApiMiddleware() {
  ensureAuthConfig();

  return async function apiMiddleware(req, res, next) {
    const url = req.url ? req.url.split('?')[0] : '';

    if (!url.startsWith('/api/')) {
      return next();
    }

    const authConfig = ensureAuthConfig();

    // 1. GET /api/menu -> Always return latest menu.json
    if (url === '/api/menu' && req.method === 'GET') {
      try {
        const content = fs.readFileSync(MENU_FILE);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', content.length);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(content);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: 'Menü verisi okunamadı.' });
      }
      return;
    }

    // 2. POST /api/auth/login -> Verify password with scrypt + timingSafeEqual
    if (url === '/api/auth/login' && req.method === 'POST') {
      const clientIp = req.socket?.remoteAddress || 'local';
      const now = Date.now();
      const attempt = loginAttempts.get(clientIp);

      if (attempt && now < attempt.resetAt && attempt.count >= MAX_ATTEMPTS) {
        const waitSec = Math.ceil((attempt.resetAt - now) / 1000);
        return sendJson(res, 429, {
          ok: false,
          error: `Çok fazla başarısız deneme. Lütfen ${waitSec} saniye bekleyin.`
        });
      }

      try {
        const { password } = await readJsonBody(req);
        if (!password || !verifyPasswordConstantTime(password, authConfig)) {
          const prev = loginAttempts.get(clientIp);
          const count = prev && now < prev.resetAt ? prev.count + 1 : 1;
          loginAttempts.set(clientIp, { count, resetAt: now + WINDOW_MS });
          return sendJson(res, 401, { ok: false, error: 'Hatalı yönetici parolası.' });
        }

        loginAttempts.delete(clientIp);
        const token = createSignedToken(authConfig.hmacSecret);
        return sendJson(res, 200, { ok: true, token });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    // 3. GET /api/auth/verify -> Check token validity
    if (url === '/api/auth/verify' && req.method === 'GET') {
      const token = extractBearerToken(req);
      const valid = verifySignedToken(token, authConfig.hmacSecret);
      return sendJson(res, valid ? 200 : 401, { ok: valid });
    }

    // 4. POST /api/auth/password -> Change admin password securely
    if (url === '/api/auth/password' && req.method === 'POST') {
      const token = extractBearerToken(req);
      if (!verifySignedToken(token, authConfig.hmacSecret)) {
        return sendJson(res, 401, { ok: false, error: 'Oturum süresi doldu, lütfen tekrar giriş yapın.' });
      }

      try {
        const { currentPassword, newPassword } = await readJsonBody(req);
        if (!currentPassword || !verifyPasswordConstantTime(currentPassword, authConfig)) {
          return sendJson(res, 401, { ok: false, error: 'Mevcut parola hatalı.' });
        }
        if (!newPassword || String(newPassword).trim().length < 4) {
          return sendJson(res, 400, { ok: false, error: 'Yeni parola en az 4 karakter olmalıdır.' });
        }

        const newSalt = crypto.randomBytes(16).toString('hex');
        const newHmacSecret = crypto.randomBytes(32).toString('hex');
        const newHash = hashPassword(String(newPassword).trim(), newSalt);

        const updatedConfig = {
          algorithm: 'scrypt-64',
          salt: newSalt,
          hash: newHash,
          hmacSecret: newHmacSecret,
          updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(AUTH_FILE, JSON.stringify(updatedConfig, null, 2), { mode: 0o600 });
        const newToken = createSignedToken(newHmacSecret);
        return sendJson(res, 200, { ok: true, token: newToken });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    // 5. POST /api/menu -> Save updated menu.json to disk
    if (url === '/api/menu' && req.method === 'POST') {
      const token = extractBearerToken(req);
      if (!verifySignedToken(token, authConfig.hmacSecret)) {
        return sendJson(res, 401, { ok: false, error: 'Yetkisiz işlem. Lütfen giriş yapın.' });
      }

      try {
        const payload = await readJsonBody(req);
        if (!payload || !Array.isArray(payload.brands)) {
          return sendJson(res, 400, { ok: false, error: 'Geçersiz menü formatı.' });
        }

        const formatted = JSON.stringify({ brands: payload.brands }, null, 2);
        fs.mkdirSync(path.dirname(MENU_FILE), { recursive: true });
        fs.writeFileSync(MENU_FILE, formatted, 'utf-8');

        // Keep dist/data/menu.json in sync if production build exists
        if (fs.existsSync(path.dirname(DIST_MENU_FILE))) {
          fs.writeFileSync(DIST_MENU_FILE, formatted, 'utf-8');
        }

        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message || 'Kaydetme hatası.' });
      }
    }

    // 6. POST /api/upload -> Save uploaded image/logo to public/uploads/
    if (url === '/api/upload' && req.method === 'POST') {
      const token = extractBearerToken(req);
      if (!verifySignedToken(token, authConfig.hmacSecret)) {
        return sendJson(res, 401, { ok: false, error: 'Yetkisiz işlem. Lütfen giriş yapın.' });
      }

      try {
        const { filename, dataUrl } = await readJsonBody(req, 15 * 1024 * 1024);
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
          return sendJson(res, 400, { ok: false, error: 'Geçersiz görsel formatı.' });
        }

        const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!matches) {
          return sendJson(res, 400, { ok: false, error: 'Görsel verisi çözümlenemedi.' });
        }

        const mimeSubtype = matches[1].toLowerCase();
        const base64Data = matches[2];

        const extMap = {
          jpeg: 'jpg',
          jpg: 'jpg',
          png: 'png',
          webp: 'webp',
          avif: 'avif',
          gif: 'gif',
          'svg+xml': 'svg'
        };
        const ext = extMap[mimeSubtype] || 'png';
        const safeBase = String(filename || 'gorsel')
          .replace(/\.[^/.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 40) || 'gorsel';

        const finalName = `${safeBase}-${Date.now()}.${ext}`;
        const buffer = Buffer.from(base64Data, 'base64');

        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOADS_DIR, finalName), buffer);

        if (fs.existsSync( path.join(ROOT_DIR, 'dist') )) {
          fs.mkdirSync(DIST_UPLOADS_DIR, { recursive: true });
          fs.writeFileSync(path.join(DIST_UPLOADS_DIR, finalName), buffer);
        }

        return sendJson(res, 200, { ok: true, url: `/uploads/${finalName}` });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message || 'Görsel yüklenemedi.' });
      }
    }

    return sendJson(res, 404, { ok: false, error: 'API uç noktası bulunamadı.' });
  };
}

