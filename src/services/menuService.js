let cachedMenu = null;
const ADMIN_TOKEN_KEY = 'qr_menu_admin_token';

async function parseJsonResponse(res, fallbackErrorMsg) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackErrorMsg || `Sunucu yanıtı okunamadı (HTTP ${res.status}).`);
  }
}

export async function fetchMenuData(forceRefresh = false) {
  if (cachedMenu && !forceRefresh) {
    return cachedMenu;
  }

  try {
    const res = await fetch(`/api/menu?t=${Date.now()}`, { cache: 'no-store' });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      cachedMenu = await res.json();
      return cachedMenu;
    }
  } catch {
    // Fallback to static JSON file
  }

  const fallbackRes = await fetch(`/data/menu.json?t=${Date.now()}`, { cache: 'no-store' });
  cachedMenu = await fallbackRes.json();
  return cachedMenu;
}

export function getCachedMenu() {
  return cachedMenu;
}

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token) {
  if (token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

export function logoutAdmin() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function verifyAdminSession() {
  const token = getAdminToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      logoutAdmin();
      return false;
    }
    const data = await parseJsonResponse(res, 'Oturum doğrulanamadı.');
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function loginAdmin(password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await parseJsonResponse(res, 'Giriş sunucusuna ulaşılamadı.');
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Giriş başarısız.');
  }
  setAdminToken(data.token);
  return true;
}

export async function changeAdminPassword(currentPassword, newPassword) {
  const token = getAdminToken();
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  const data = await parseJsonResponse(res, 'Parola güncellenemedi.');
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Parola güncellenemedi.');
  }
  if (data.token) {
    setAdminToken(data.token);
  }
  return true;
}

export async function saveMenuData(menuData) {
  const token = getAdminToken();
  const res = await fetch('/api/menu', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(menuData)
  });
  const data = await parseJsonResponse(res, 'Menü kaydedilemedi.');
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Menü kaydedilemedi.');
  }
  cachedMenu = JSON.parse(JSON.stringify(menuData));
  return true;
}

export async function uploadImageFile(file) {
  const token = getAdminToken();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      filename: file.name,
      dataUrl
    })
  });
  const data = await parseJsonResponse(res, 'Görsel yüklenemedi.');
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Görsel yüklenemedi.');
  }
  return data.url;
}

