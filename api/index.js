import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'image/avif': '.avif'
};

function sendJson(res, statusCode, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf-8');
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', payload.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function getApiRoute(req) {
  const parsed = new URL(req.url || '/', 'http://localhost');
  const viaQuery = parsed.searchParams.get('__path');
  if (viaQuery) {
    return '/api/' + viaQuery.replace(/^\/+/, '');
  }
  return parsed.pathname;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    return JSON.parse(req.body);
  }
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf-8'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Geçersiz JSON verisi.'));
      }
    });
    req.on('error', reject);
  });
}

function getDefaultAuthConfig() {
  const seed = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_PROJECT_ID || 'qrmenu-vercel-default-seed';
  const salt = crypto.createHash('sha256').update(seed + ':salt').digest('hex').slice(0, 32);
  const secret = crypto.createHash('sha256').update(seed + ':secret').digest('hex');
  const hash = crypto.scryptSync('1234', salt, 64).toString('hex');
  return { salt, hash, secret };
}

async function loadAuthConfig() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { blobs } = await list({ prefix: 'qrmenu-state/auth-' });
      if (blobs && blobs.length > 0) {
        blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const res = await fetch(blobs[0].url, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.salt && data.hash && data.secret) {
            return data;
          }
        }
      }
    } catch {
      // Fallback to default config if Blob read fails
    }
  }
  return getDefaultAuthConfig();
}

async function saveAuthConfig(config) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      'Canlı sitede parola kaydetmek için Vercel panelinizden Storage -> Create Database -> Blob oluşturup projeye bağlayın ve Redeploy yapın.'
    );
  }
  const { blobs } = await list({ prefix: 'qrmenu-state/auth-' });
  await put(`qrmenu-state/auth-${Date.now()}.json`, JSON.stringify(config, null, 2), {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'application/json'
  });
  if (blobs && blobs.length > 0) {
    await del(blobs.map((b) => b.url));
  }
}

function verifyPassword(password, salt, expectedHashHex) {
  if (typeof password !== 'string' || !password) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function createSignedToken(secret) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySignedToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  const payload = `${expStr}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

async function loadMenuJsonString(req) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { blobs } = await list({ prefix: 'qrmenu-state/menu-' });
      if (blobs && blobs.length > 0) {
        blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        const res = await fetch(blobs[0].url, { cache: 'no-store' });
        if (res.ok) {
          return await res.text();
        }
      }
    } catch {
      // Fallback to static file
    }
  }

  const localPath = path.join(process.cwd(), 'public', 'data', 'menu.json');
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath, 'utf-8');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const staticRes = await fetch(`${proto}://${host}/data/menu.json`, { cache: 'no-store' });
  if (staticRes.ok) {
    return await staticRes.text();
  }
  throw new Error('Menü verisi okunamadı.');
}

export default async function handler(req, res) {
  const route = getApiRoute(req);

  // 1. GET /api/menu
  if (route === '/api/menu' && req.method === 'GET') {
    try {
      const jsonStr = await loadMenuJsonString(req);
      const payload = Buffer.from(jsonStr, 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', payload.length);
      res.setHeader('Cache-Control', 'no-store');
      res.end(payload);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || 'Menü verisi okunamadı.' });
    }
    return;
  }

  const authConfig = await loadAuthConfig();

  // 2. POST /api/auth/login
  if (route === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const isValid = verifyPassword(body.password || '', authConfig.salt, authConfig.hash);
      if (!isValid) {
        return sendJson(res, 401, { ok: false, error: 'Hatalı yönetici parolası.' });
      }
      const token = createSignedToken(authConfig.secret);
      return sendJson(res, 200, { ok: true, token });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || 'Giriş isteği geçersiz.' });
    }
  }

  // 3. GET /api/auth/verify
  if (route === '/api/auth/verify' && req.method === 'GET') {
    const token = extractBearerToken(req);
    const valid = verifySignedToken(token, authConfig.secret);
    if (!valid) {
      return sendJson(res, 401, { ok: false, error: 'Oturum süresi doldu veya geçersiz.' });
    }
    return sendJson(res, 200, { ok: true });
  }

  // Require valid admin token for all write routes below
  const token = extractBearerToken(req);
  if (!verifySignedToken(token, authConfig.secret)) {
    return sendJson(res, 401, { ok: false, error: 'Yetkisiz işlem. Lütfen tekrar giriş yapın.' });
  }

  // 4. POST /api/auth/password
  if (route === '/api/auth/password' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { currentPassword, newPassword } = body;

      if (!verifyPassword(currentPassword || '', authConfig.salt, authConfig.hash)) {
        return sendJson(res, 401, { ok: false, error: 'Mevcut parola hatalı.' });
      }
      if (typeof newPassword !== 'string' || newPassword.trim().length < 4) {
        return sendJson(res, 400, { ok: false, error: 'Yeni parola en az 4 karakter olmalıdır.' });
      }

      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = crypto.scryptSync(newPassword.trim(), newSalt, 64).toString('hex');
      const updatedConfig = {
        salt: newSalt,
        hash: newHash,
        secret: authConfig.secret
      };

      await saveAuthConfig(updatedConfig);
      const newToken = createSignedToken(updatedConfig.secret);
      return sendJson(res, 200, { ok: true, token: newToken });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || 'Parola güncellenemedi.' });
    }
  }

  // 5. POST /api/menu
  if (route === '/api/menu' && req.method === 'POST') {
    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return sendJson(res, 400, {
          ok: false,
          error:
            'Canlı sitede kayıt yapabilmek için Vercel panelinizden Storage -> Create Database -> Blob oluşturup projeye bağlayın ve Redeploy yapın.'
        });
      }

      const body = await readJsonBody(req);
      if (!body || !Array.isArray(body.brands)) {
        return sendJson(res, 400, { ok: false, error: 'Geçersiz menü veri formatı.' });
      }

      const { blobs } = await list({ prefix: 'qrmenu-state/menu-' });
      await put(`qrmenu-state/menu-${Date.now()}.json`, JSON.stringify(body, null, 2), {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'application/json'
      });
      if (blobs && blobs.length > 0) {
        await del(blobs.map((b) => b.url));
      }

      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Menü kaydedilirken hata oluştu.' });
    }
  }

  // 6. POST /api/upload
  if (route === '/api/upload' && req.method === 'POST') {
    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return sendJson(res, 400, {
          ok: false,
          error:
            'Canlı sitede fotoğraf yükleyebilmek için Vercel panelinizden Storage -> Create Database -> Blob oluşturup projeye bağlayın ve Redeploy yapın.'
        });
      }

      const body = await readJsonBody(req);
      const { filename, dataUrl } = body;
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return sendJson(res, 400, { ok: false, error: 'Geçersiz görsel formatı.' });
      }

      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        return sendJson(res, 400, { ok: false, error: 'Görsel verisi çözümlenemedi.' });
      }

      const mime = match[1].toLowerCase();
      const base64Data = match[2];
      const ext = MIME_TO_EXT[mime];
      if (!ext) {
        return sendJson(res, 400, { ok: false, error: 'Desteklenmeyen görsel türü.' });
      }

      const buffer = Buffer.from(base64Data, 'base64');
      const safeBase = (filename || 'gorsel')
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40);

      const finalName = `uploads/${safeBase || 'urun'}-${Date.now()}${ext}`;
      const blob = await put(finalName, buffer, {
        access: 'public',
        addRandomSuffix: false,
        contentType: mime
      });

      return sendJson(res, 200, {
        ok: true,
        url: blob.url
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Görsel yüklenirken hata oluştu.' });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'API uç noktası bulunamadı.' });
}
