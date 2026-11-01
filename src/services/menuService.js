let cachedMenu = null;
let inMemoryAdminToken = '';

export async function fetchMenuData(forceRefresh = false) {
  if (cachedMenu && !forceRefresh) {
    return cachedMenu;
  }

  try {
    const res = await fetch(`/api/menu?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
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
  return inMemoryAdminToken;
}

export function setAdminToken(token) {
  inMemoryAdminToken = token || '';
  sessionStorage.removeItem('qr_menu_admin_token');
}

export function logoutAdmin() {
  inMemoryAdminToken = '';
  sessionStorage.removeItem('qr_menu_admin_token');
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
    const data = await res.json();
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
  const data = await res.json();
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
  const data = await res.json();
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
  const data = await res.json();
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
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Görsel yüklenemedi.');
  }
  return data.url;
}

