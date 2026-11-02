import {
  fetchMenuData,
  verifyAdminSession,
  loginAdmin,
  logoutAdmin,
  changeAdminPassword,
  saveMenuData,
  uploadImageFile
} from './services/menuService.js';

const BRAND_STORAGE_KEY = 'qr_menu_admin_selected_brand';

let adminState = {
  authenticated: false,
  selectedBrandId: sessionStorage.getItem(BRAND_STORAGE_KEY) || null,
  editingProduct: null, // { brandId, categoryId, product } or null
  croppingProduct: null, // { categoryId, productId, image, crop: { x, y, zoom, fit } } or null
  isNewProduct: false,
  showPasswordModal: false,
  toastMessage: '',
  toastType: 'success'
};

function setSelectedBrandId(brandId) {
  adminState.selectedBrandId = brandId;
  if (brandId) {
    sessionStorage.setItem(BRAND_STORAGE_KEY, brandId);
  }
}

let toastTimer = null;
function showToast(container, message, type = 'success') {
  adminState.toastMessage = message;
  adminState.toastType = type;
  const toastEl = container.querySelector('#admin-toast');
  if (toastEl) {
    toastEl.textContent = message;
    toastEl.style.backgroundColor = type === 'error' ? '#DC2626' : '#059669';
    toastEl.style.color = '#FFFFFF';
    toastEl.className =
      'fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-sm cal-bold transition-all duration-200';
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    const current = container.querySelector('#admin-toast');
    if (current) current.className = 'hidden';
  }, 2600);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripCurrency(price) {
  return String(price ?? '')
    .replace(/₺/g, '')
    .replace(/\bTL\b/gi, '')
    .trim();
}

function formatPrice(price) {
  const cleaned = stripCurrency(price);
  return cleaned ? `${cleaned} ₺` : '';
}

function normalizeCrop(crop) {
  return {
    x: Math.round(Number(crop?.x) || 0),
    y: Math.round(Number(crop?.y) || 0),
    zoom: Number(Number(crop?.zoom || 1).toFixed(2)),
    fit: crop?.fit === 'contain' ? 'contain' : 'cover'
  };
}

function getProductImageStyle(crop) {
  if (!crop) return '';
  const c = normalizeCrop(crop);
  return `object-fit: ${c.fit}; transform: translate(${c.x}%, ${c.y}%) scale(${c.zoom}); transform-origin: center center;`;
}

export async function renderAdminView(container) {
  const isValid = await verifyAdminSession();
  adminState.authenticated = isValid;

  if (!adminState.authenticated) {
    renderLoginScreen(container);
    return;
  }

  const menuData = await fetchMenuData(true);
  const savedBrand = sessionStorage.getItem(BRAND_STORAGE_KEY);
  if (savedBrand && menuData.brands.some((b) => b.id === savedBrand)) {
    adminState.selectedBrandId = savedBrand;
  } else if (!adminState.selectedBrandId && menuData.brands.length > 0) {
    setSelectedBrandId(menuData.brands[0].id);
  }

  renderDashboard(container, menuData);
}

function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="min-h-dvh bg-offwhite flex items-center justify-center px-5 py-10">
      <div class="w-full max-w-sm bg-white rounded-2xl p-7 shadow-[0_8px_30px_rgba(0,0,0,0.06)] border border-neutral-200/80">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-2xl cal-bold text-neutral-900">Yönetim Paneli</h1>
            <p class="text-xs cal-normal text-neutral-600 mt-1">Ürün, fiyat ve görselleri yönetmek için giriş yapın</p>
          </div>
          <a href="#/" class="text-xs cal-bold px-3 py-1.5 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-neutral-300 transition">
            Menüye Dön
          </a>
        </div>

        <form id="admin-login-form" class="space-y-4">
          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1.5">Yönetici Parolası</label>
            <input
              type="password"
              id="admin-password-input"
              required
              autofocus
              placeholder="Parolanızı girin..."
              class="w-full px-4 py-3 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900 focus:outline-none focus:border-blue-600"
            />
          </div>
          <div id="admin-login-error" class="hidden text-xs text-red-600 cal-normal"></div>
          <button
            type="submit"
            id="admin-login-btn"
            style="background-color: #2563EB; color: #FFFFFF;"
            class="w-full py-3.5 rounded-xl text-sm cal-bold hover:opacity-95 active:scale-[0.99] transition cursor-pointer shadow-sm"
          >
            Giriş Yap
          </button>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#admin-login-form');
  const input = container.querySelector('#admin-password-input');
  const errorEl = container.querySelector('#admin-login-error');
  const btn = container.querySelector('#admin-login-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Doğrulanıyor...';

    try {
      await loginAdmin(input.value);
      adminState.authenticated = true;
      await renderAdminView(container);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Giriş Yap';
    }
  });
}

function renderDashboard(container, menuData, preserveScroll = true) {
  const previousScrollY = preserveScroll ? window.scrollY : 0;
  const brands = menuData.brands || [];
  const activeBrand = brands.find((b) => b.id === adminState.selectedBrandId) || brands[0];
  if (activeBrand && activeBrand.id !== adminState.selectedBrandId) {
    setSelectedBrandId(activeBrand.id);
  }

  container.innerHTML = `
    <div class="min-h-dvh bg-offwhite pb-20">
      <!-- Top Admin Bar -->
      <header class="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200 px-4 py-3.5">
        <div class="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-3">
            <a
              href="#/"
              class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-900 text-xs cal-bold transition"
            >
              ← Canlı Menüyü Gör
            </a>
            <h1 class="text-base sm:text-lg cal-bold text-neutral-900">Menü Yönetim Paneli</h1>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              id="btn-open-pass-modal"
              class="px-3.5 py-2 rounded-xl border border-neutral-300 bg-white text-neutral-800 text-xs cal-bold hover:bg-neutral-100 cursor-pointer"
            >
              Parola Değiştir
            </button>
            <button
              type="button"
              id="btn-admin-logout"
              style="background-color: #FEE2E2; color: #B91C1C;"
              class="px-3.5 py-2 rounded-xl text-xs cal-bold hover:opacity-90 cursor-pointer"
            >
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <main class="max-w-4xl mx-auto px-4 pt-5 space-y-6">
        <!-- 4 Brand Selector Tabs -->
        <section class="bg-white rounded-2xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-neutral-200/80">
          <div class="text-xs cal-bold text-neutral-700 mb-2.5">1. Düzenlemek İstediğiniz Markayı Seçin:</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            ${brands
              .map((brand) => {
                const isSelected = brand.id === activeBrand.id;
                return `
              <button
                type="button"
                data-brand-tab="${escapeHtml(brand.id)}"
                style="${
                  isSelected
                    ? 'background-color: #2563EB; color: #FFFFFF; border-color: #1D4ED8;'
                    : 'background-color: #F8FAFC; color: #1E293B; border-color: #CBD5E1;'
                }"
                class="px-3.5 py-3 rounded-xl text-left transition cursor-pointer border-2 shadow-2xs hover:opacity-95"
              >
                <div class="text-sm cal-bold truncate">${escapeHtml(brand.name)}</div>
                <div class="text-[11px] cal-normal mt-0.5 opacity-90">
                  ${brand.categories.length} Kategori • ${brand.categories.reduce((acc, c) => acc + c.products.length, 0)} Ürün
                </div>
              </button>
            `;
              })
              .join('')}
          </div>
        </section>

        <!-- Active Brand Logo & Info Section -->
        <section class="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-neutral-200/80">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="w-44 h-16 bg-offwhite rounded-xl flex items-center justify-center border border-neutral-300 overflow-hidden shrink-0">
                <img
                  id="active-brand-logo-img"
                  src="${escapeHtml(activeBrand.logo)}"
                  alt="${escapeHtml(activeBrand.name)}"
                  class="w-full h-full object-contain"
                />
              </div>
              <div>
                <h2 class="text-lg cal-bold text-neutral-900">${escapeHtml(activeBrand.name)}</h2>
                <p class="text-xs cal-normal text-neutral-600">Anasayfa Marka Logosu (Önerilen: 1200×450 px)</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                id="btn-brand-move-up"
                ${brands.findIndex((b) => b.id === activeBrand.id) === 0 ? 'disabled' : ''}
                class="px-3 py-2.5 rounded-xl border border-neutral-300 bg-neutral-50 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                title="Anasayfada Yukarı Taşı"
              >
                ↑ Sırayı Yukarı Taşı
              </button>
              <button
                type="button"
                id="btn-brand-move-down"
                ${brands.findIndex((b) => b.id === activeBrand.id) === brands.length - 1 ? 'disabled' : ''}
                class="px-3 py-2.5 rounded-xl border border-neutral-300 bg-neutral-50 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                title="Anasayfada Aşağı Taşı"
              >
                ↓ Sırayı Aşağı Taşı
              </button>
              <label
                style="background-color: #2563EB; color: #FFFFFF;"
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer transition shadow-xs"
              >
                <span>📤 Marka Logosu Yükle</span>
                <input type="file" id="brand-logo-upload" accept="image/*" class="hidden" />
              </label>
            </div>
          </div>
        </section>

        <!-- Add Category Bar -->
        <section class="bg-white rounded-2xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-neutral-200/80">
          <form id="add-category-form" class="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              id="new-category-name"
              required
              placeholder="${escapeHtml(activeBrand.name)} için yeni kategori adı yazın (Örn: Tatlılar)..."
              class="flex-1 px-4 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              style="background-color: #059669; color: #FFFFFF;"
              class="px-5 py-2.5 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer shrink-0 shadow-xs"
            >
              + Yeni Kategori Ekle
            </button>
          </form>
        </section>

        <!-- Categories & Products List -->
        <div class="space-y-5">
          ${activeBrand.categories
            .map(
              (cat, catIndex) => `
            <section class="bg-white rounded-2xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-neutral-200/80">
              <div class="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-neutral-200">
                <div class="flex items-center gap-2">
                  <span class="text-base cal-bold text-neutral-900">${escapeHtml(cat.name)}</span>
                  <span class="text-xs cal-normal text-neutral-700 px-2.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200">${cat.products.length} ürün</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-cat-up="${escapeHtml(cat.id)}"
                    ${catIndex === 0 ? 'disabled' : ''}
                    title="Yukarı Taşı"
                    class="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-neutral-50 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                  >↑</button>
                  <button
                    type="button"
                    data-cat-down="${escapeHtml(cat.id)}"
                    ${catIndex === activeBrand.categories.length - 1 ? 'disabled' : ''}
                    title="Aşağı Taşı"
                    class="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-neutral-50 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer"
                  >↓</button>
                  <button
                    type="button"
                    data-cat-rename="${escapeHtml(cat.id)}"
                    class="px-3 py-1.5 rounded-lg border border-neutral-300 bg-neutral-50 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 cursor-pointer"
                  >İsmi Düzenle</button>
                  <button
                    type="button"
                    data-cat-delete="${escapeHtml(cat.id)}"
                    style="background-color: #FEF2F2; color: #DC2626; border-color: #FECACA;"
                    class="px-3 py-1.5 rounded-lg border text-xs cal-bold hover:opacity-90 cursor-pointer"
                  >Kategoriyi Sil</button>
                  <button
                    type="button"
                    data-add-product="${escapeHtml(cat.id)}"
                    style="background-color: #2563EB; color: #FFFFFF;"
                    class="ml-1 px-3.5 py-1.5 rounded-lg text-xs cal-bold hover:opacity-95 cursor-pointer shadow-2xs"
                  >+ Ürün Ekle</button>
                </div>
              </div>

              ${
                cat.products.length === 0
                  ? `<div class="text-center py-6 text-xs cal-normal text-neutral-600">Bu kategoride henüz ürün yok. Sağ üstteki "+ Ürün Ekle" butonuna tıklayarak ekleyebilirsiniz.</div>`
                  : `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      ${cat.products
                        .map(
                          (prod, prodIndex) => `
                        <div
                          data-prod-card="${escapeHtml(prod.id)}"
                          data-prod-cat="${escapeHtml(cat.id)}"
                          data-prod-idx="${prodIndex}"
                          draggable="true"
                          class="flex items-center gap-2.5 p-3 rounded-xl border transition-all ${
                            prod.available === false
                              ? 'bg-neutral-100 border-neutral-300 opacity-70'
                              : 'bg-offwhite/70 border-neutral-200'
                          }"
                        >
                          <!-- Product Order (#1, #2), Drag Handle & Up/Down Buttons -->
                          <div class="flex flex-col items-center gap-1 shrink-0 select-none">
                            <div
                              data-drag-handle="${escapeHtml(prod.id)}"
                              title="Basılı tutup sürükleyerek sırasını değiştirin"
                              style="touch-action: none; cursor: grab;"
                              class="px-1.5 py-0.5 rounded bg-neutral-200/90 text-neutral-800 text-[11px] cal-bold flex items-center gap-0.5 active:scale-95"
                            >
                              <span>⠿</span>
                              <span>#${prodIndex + 1}</span>
                            </div>
                            <div class="flex items-center gap-0.5">
                              <button
                                type="button"
                                data-prod-up="${escapeHtml(prod.id)}"
                                data-cat-id="${escapeHtml(cat.id)}"
                                ${prodIndex === 0 ? 'disabled' : ''}
                                title="Öne / Yukarı Taşı"
                                class="w-6 h-6 rounded border border-neutral-300 bg-white text-neutral-800 text-[11px] cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer flex items-center justify-center"
                              >↑</button>
                              <button
                                type="button"
                                data-prod-down="${escapeHtml(prod.id)}"
                                data-cat-id="${escapeHtml(cat.id)}"
                                ${prodIndex === cat.products.length - 1 ? 'disabled' : ''}
                                title="Arkaya / Aşağı Taşı"
                                class="w-6 h-6 rounded border border-neutral-300 bg-white text-neutral-800 text-[11px] cal-bold hover:bg-neutral-200 disabled:opacity-30 cursor-pointer flex items-center justify-center"
                              >↓</button>
                            </div>
                          </div>

                          <button
                            type="button"
                            data-quick-photo="${escapeHtml(prod.id)}"
                            data-cat-id="${escapeHtml(cat.id)}"
                            title="Fotoğrafı ve kart görünümünü (kırpma/boyut/konum) düzenlemek için tıklayın"
                            class="relative w-16 h-16 rounded-lg overflow-hidden bg-white border border-neutral-300 shrink-0 cursor-pointer group p-0"
                          >
                            <img
                              data-prod-thumb="${escapeHtml(prod.id)}"
                              src="${escapeHtml(prod.image)}"
                              alt="${escapeHtml(prod.name)}"
                              style="${escapeHtml(getProductImageStyle(prod.imageCrop))}"
                              class="w-full h-full object-cover group-hover:opacity-80 transition pointer-events-none"
                            />
                            <span
                              style="background-color: rgba(20,20,19,0.75); color: #FFFFFF;"
                              class="absolute bottom-0.5 right-0.5 text-[10px] px-1 py-0.5 rounded leading-none pointer-events-none"
                            >📷</span>
                          </button>
                          <div class="flex-1 min-w-0">
                            <div class="text-sm cal-bold text-neutral-900 truncate">${escapeHtml(prod.name)}</div>
                            <div class="text-xs cal-normal text-neutral-600 truncate mt-0.5">${escapeHtml(prod.description || '')}</div>
                            <div class="flex items-center gap-2 mt-1.5">
                              <button
                                type="button"
                                data-quick-price="${escapeHtml(prod.id)}"
                                data-cat-id="${escapeHtml(cat.id)}"
                                title="Fiyatı hızlı değiştirmek için tıklayın"
                                class="text-xs cal-bold text-neutral-900 bg-white hover:bg-blue-50 hover:border-blue-400 px-2 py-0.5 rounded border border-neutral-300 cursor-pointer transition inline-flex items-center gap-1"
                              >
                                <span>${escapeHtml(formatPrice(prod.price))}</span>
                                <span class="text-[10px] text-neutral-400">✎</span>
                              </button>
                              ${
                                prod.available === false
                                  ? `<span style="background-color:#FEE2E2;color:#B91C1C;" class="text-[11px] px-2 py-0.5 rounded cal-bold">Gizli / Tükendi</span>`
                                  : `<span style="background-color:#D1FAE5;color:#065F46;" class="text-[11px] px-2 py-0.5 rounded cal-bold">Aktif</span>`
                              }
                            </div>
                          </div>
                          <div class="flex flex-col gap-1.5 shrink-0">
                            <button
                              type="button"
                              data-edit-prod="${escapeHtml(prod.id)}"
                              data-cat-id="${escapeHtml(cat.id)}"
                              style="background-color: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE;"
                              class="px-2.5 py-1 rounded-lg border text-xs cal-bold hover:opacity-90 cursor-pointer"
                            >Düzenle</button>
                            <button
                              type="button"
                              data-toggle-prod="${escapeHtml(prod.id)}"
                              data-cat-id="${escapeHtml(cat.id)}"
                              class="px-2.5 py-1 rounded-lg border border-neutral-300 bg-white text-neutral-800 text-[11px] cal-bold hover:bg-neutral-100 cursor-pointer"
                            >${prod.available === false ? 'Aktif Et' : 'Gizle'}</button>
                            <button
                              type="button"
                              data-del-prod="${escapeHtml(prod.id)}"
                              data-cat-id="${escapeHtml(cat.id)}"
                              style="background-color: #FEF2F2; color: #DC2626; border-color: #FECACA;"
                              class="px-2.5 py-1 rounded-lg border text-[11px] cal-bold hover:opacity-90 cursor-pointer"
                            >Sil</button>
                          </div>
                        </div>
                      `
                        )
                        .join('')}
                    </div>`
              }
            </section>
          `
            )
            .join('')}
        </div>
      </main>

      <!-- Product Add / Edit Modal -->
      ${adminState.editingProduct ? renderProductModalHtml(activeBrand) : ''}

      <!-- Photo & Grid Preview Crop/Position Modal -->
      ${adminState.croppingProduct ? renderPhotoCropModalHtml(activeBrand) : ''}

      <!-- Password Change Modal -->
      ${adminState.showPasswordModal ? renderPasswordModalHtml() : ''}

      <div id="admin-toast" class="hidden"></div>
    </div>
  `;

  if (preserveScroll && previousScrollY > 0) {
    window.scrollTo({ top: previousScrollY, behavior: 'instant' });
  }

  bindDashboardEvents(container, menuData, activeBrand);
}

function renderPhotoCropModalHtml(activeBrand) {
  const { categoryId, productId, image, crop } = adminState.croppingProduct;
  const cat = activeBrand.categories.find((c) => c.id === categoryId);
  const prod = cat?.products.find((p) => p.id === productId);
  if (!prod) return '';

  const c = normalizeCrop(crop);

  return `
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div class="bg-white w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4 max-h-[94dvh] overflow-y-auto">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-base sm:text-lg cal-bold text-neutral-900">Fotoğraf & Kart Önizleme Düzenleyici</h3>
            <p class="text-[11.5px] cal-normal text-neutral-600 mt-0.5">
              Detay sayfasındaki tam boy fotoğraf bozulmaz; buradaki ayar sadece menüdeki 2'li kart görünümünü düzenler.
            </p>
          </div>
          <button
            type="button"
            id="btn-close-crop-modal"
            class="text-sm cal-bold px-2.5 py-1 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-neutral-300 cursor-pointer shrink-0"
          >✕</button>
        </div>

        <!-- Upload / Replace Photo Button -->
        <div class="flex items-center justify-between gap-2 bg-neutral-50 p-2.5 rounded-xl border border-neutral-200">
          <span class="text-xs cal-normal text-neutral-700 truncate">${escapeHtml(prod.name)}</span>
          <label
            style="background-color: #2563EB; color: #FFFFFF;"
            class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer shrink-0 shadow-2xs"
          >
            <span>📤 Yeni Fotoğraf Yükle</span>
            <input type="file" id="crop-modal-file-input" accept="image/*" class="hidden" />
          </label>
        </div>

        <!-- Live 1:1 Menu Grid Card Preview -->
        <div class="bg-offwhite rounded-2xl p-4 border border-neutral-200/80 flex flex-col items-center">
          <div class="text-[11px] cal-bold text-neutral-600 mb-2">
            ✋ Fotoğrafın üzerine basılı tutup sürükleyerek konumlandırabilirsiniz
          </div>

          <article
            style="width: 182px; height: 220px;"
            class="product-card rounded-2xl overflow-hidden flex flex-col select-none border border-black/[0.05] bg-white shadow-md"
          >
            <div
              id="crop-interactive-area"
              style="touch-action: none; cursor: grab;"
              class="relative w-full h-[57%] bg-neutral-100/70 overflow-hidden shrink-0"
            >
              <img
                id="crop-preview-img"
                src="${escapeHtml(image)}"
                alt="${escapeHtml(prod.name)}"
                draggable="false"
                style="${escapeHtml(getProductImageStyle(c))}"
                class="w-full h-full object-cover pointer-events-none select-none"
              />
            </div>
            <div class="flex-1 flex flex-col justify-between p-2.5 min-h-0 bg-white">
              <div class="min-w-0">
                <h4 class="text-[13.5px] leading-tight cal-bold truncate text-neutral-900">${escapeHtml(prod.name)}</h4>
                <p class="text-[11.5px] leading-snug cal-normal italic opacity-60 truncate mt-0.5 text-neutral-700">
                  ${escapeHtml(prod.description || '')}
                </p>
              </div>
              <div class="text-[13px] cal-normal pt-1 text-neutral-900">${escapeHtml(formatPrice(prod.price))}</div>
            </div>
          </article>
        </div>

        <!-- Fit Mode & Reset Controls -->
        <div class="flex items-center justify-between gap-2">
          <div class="inline-flex rounded-xl p-1 bg-neutral-100 border border-neutral-200">
            <button
              type="button"
              id="btn-fit-cover"
              style="${c.fit === 'cover' ? 'background-color:#141413;color:#FFFFFF;' : 'color:#404040;'}"
              class="px-3 py-1.5 rounded-lg text-xs cal-bold transition cursor-pointer"
            >
              Çerçeveyi Doldur
            </button>
            <button
              type="button"
              id="btn-fit-contain"
              style="${c.fit === 'contain' ? 'background-color:#141413;color:#FFFFFF;' : 'color:#404040;'}"
              class="px-3 py-1.5 rounded-lg text-xs cal-bold transition cursor-pointer"
            >
              Tam Sığdır
            </button>
          </div>

          <button
            type="button"
            id="btn-crop-reset"
            class="px-3 py-1.5 rounded-xl border border-neutral-300 bg-white text-neutral-800 text-xs cal-bold hover:bg-neutral-100 cursor-pointer"
          >
            ↺ Sıfırla
          </button>
        </div>

        <!-- Sliders: Zoom, Horizontal (X), Vertical (Y) -->
        <div class="space-y-3 bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
          <div>
            <div class="flex justify-between text-xs cal-bold text-neutral-800 mb-1">
              <span>🔍 Boyut / Yakınlaştırma (Zoom)</span>
              <span id="crop-zoom-val">${Math.round(c.zoom * 100)}%</span>
            </div>
            <input
              type="range"
              id="crop-zoom-slider"
              min="0.5"
              max="3"
              step="0.02"
              value="${c.zoom}"
              class="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div>
            <div class="flex justify-between text-xs cal-bold text-neutral-800 mb-1">
              <span>↔ Yatay Konum (Sol / Sağ)</span>
              <span id="crop-x-val">${c.x}%</span>
            </div>
            <input
              type="range"
              id="crop-x-slider"
              min="-100"
              max="100"
              step="1"
              value="${c.x}"
              class="w-full accent-blue-600 cursor-pointer"
            />
          </div>

          <div>
            <div class="flex justify-between text-xs cal-bold text-neutral-800 mb-1">
              <span>↕ Dikey Konum (Yukarı / Aşağı)</span>
              <span id="crop-y-val">${c.y}%</span>
            </div>
            <input
              type="range"
              id="crop-y-slider"
              min="-100"
              max="100"
              step="1"
              value="${c.y}"
              class="w-full accent-blue-600 cursor-pointer"
            />
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200">
          <button
            type="button"
            id="btn-cancel-crop-modal"
            class="px-4 py-2.5 rounded-xl border border-neutral-300 bg-neutral-100 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 cursor-pointer"
          >
            İptal
          </button>
          <button
            type="button"
            id="btn-save-crop-modal"
            style="background-color: #059669; color: #FFFFFF;"
            class="px-5 py-2.5 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer shadow-xs"
          >
            Görünümü Kaydet
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderProductModalHtml(activeBrand) {
  const { categoryId, product } = adminState.editingProduct;
  const isNew = adminState.isNewProduct;

  return `
    <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-md rounded-2xl p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h3 class="text-lg cal-bold text-neutral-900">${isNew ? 'Yeni Ürün Ekle' : 'Ürünü Düzenle'}</h3>
          <button type="button" id="btn-close-prod-modal" class="text-sm cal-bold px-2.5 py-1 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-neutral-300 cursor-pointer">✕</button>
        </div>

        <form id="product-modal-form" class="space-y-3.5">
          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Kategori</label>
            <select id="prod-category-select" class="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900 bg-white">
              ${activeBrand.categories
                .map(
                  (c) =>
                    `<option value="${escapeHtml(c.id)}" ${c.id === categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                )
                .join('')}
            </select>
          </div>

          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Ürün Fotoğrafı</label>
            <div class="flex items-center gap-3">
              <img id="prod-image-preview" src="${escapeHtml(product.image || '/images/tavuk-doner.svg')}" class="w-20 h-20 rounded-xl object-cover border border-neutral-300 bg-offwhite shrink-0" />
              <div class="flex-1 space-y-1.5">
                <label
                  style="background-color: #2563EB; color: #FFFFFF;"
                  class="inline-block px-3.5 py-2 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer shadow-2xs"
                >
                  📤 Cihazdan Fotoğraf Seç
                  <input type="file" id="prod-image-file" accept="image/*" class="hidden" />
                </label>
                <input
                  type="text"
                  id="prod-image-url"
                  value="${escapeHtml(product.image || '/images/tavuk-doner.svg')}"
                  placeholder="Veya görsel yolu (/uploads/...)"
                  class="w-full px-3 py-1.5 rounded-lg border border-neutral-300 text-xs cal-normal text-neutral-800"
                />
              </div>
            </div>
          </div>

          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Ürün İsmi (Bold görünür)</label>
            <input
              type="text"
              id="prod-name-input"
              required
              value="${escapeHtml(product.name)}"
              placeholder="Örn: Zurna Tavuk Döner Dürüm"
              class="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900"
            />
          </div>

          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Ürün Açıklaması (Normal görünür)</label>
            <textarea
              id="prod-desc-input"
              rows="3"
              placeholder="Ürün içeriği ve detayları..."
              class="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900"
            >${escapeHtml(product.description)}</textarea>
          </div>

          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Fiyat (Sadece sayı yazmanız yeterli, otomatik ₺ eklenir)</label>
            <div class="relative flex items-center">
              <input
                type="text"
                inputmode="decimal"
                id="prod-price-input"
                required
                value="${escapeHtml(stripCurrency(product.price))}"
                placeholder="Örn: 175"
                class="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900"
              />
              <span class="absolute right-3.5 text-sm cal-bold text-neutral-500 pointer-events-none select-none">₺</span>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <input type="checkbox" id="prod-available-check" ${product.available !== false ? 'checked' : ''} class="w-4 h-4" />
            <label for="prod-available-check" class="text-xs cal-normal text-neutral-800">Menüde Aktif Göster (İşareti kaldırırsanız gizlenir)</label>
          </div>

          <div class="flex items-center justify-end gap-2 pt-3 border-t border-neutral-200">
            <button type="button" id="btn-cancel-prod-modal" class="px-4 py-2.5 rounded-xl border border-neutral-300 bg-neutral-100 text-neutral-800 text-xs cal-bold hover:bg-neutral-200 cursor-pointer">
              İptal
            </button>
            <button
              type="submit"
              id="btn-save-prod-modal"
              style="background-color: #059669; color: #FFFFFF;"
              class="px-5 py-2.5 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer shadow-xs"
            >
              Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPasswordModalHtml() {
  return `
    <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div class="bg-white w-full max-w-sm rounded-2xl p-6 shadow-xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base cal-bold text-neutral-900">Yönetici Parolasını Değiştir</h3>
          <button type="button" id="btn-close-pass-modal" class="text-sm cal-bold px-2.5 py-1 rounded-lg bg-neutral-200 text-neutral-900 cursor-pointer">✕</button>
        </div>
        <form id="change-password-form" class="space-y-3">
          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Mevcut Parola</label>
            <input type="password" id="curr-pass-input" required class="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900" />
          </div>
          <div>
            <label class="block text-xs cal-bold text-neutral-900 mb-1">Yeni Güçlü Parola</label>
            <input type="password" id="new-pass-input" required minlength="4" class="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-sm cal-normal text-neutral-900" />
          </div>
          <div id="pass-modal-error" class="hidden text-xs text-red-600 cal-normal"></div>
          <div class="flex justify-end gap-2 pt-2">
            <button
              type="submit"
              style="background-color: #2563EB; color: #FFFFFF;"
              class="px-5 py-2.5 rounded-xl text-xs cal-bold hover:opacity-95 cursor-pointer"
            >
              Şifrele ve Güncelle
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function bindDashboardEvents(container, menuData, activeBrand) {
  // Brand tab switching
  container.querySelectorAll('[data-brand-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSelectedBrandId(btn.getAttribute('data-brand-tab'));
      renderDashboard(container, menuData, true);
    });
  });

  // Move brand up in homepage order
  container.querySelector('#btn-brand-move-up')?.addEventListener('click', async () => {
    const idx = menuData.brands.findIndex((b) => b.id === activeBrand.id);
    if (idx > 0) {
      const temp = menuData.brands[idx - 1];
      menuData.brands[idx - 1] = menuData.brands[idx];
      menuData.brands[idx] = temp;
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, `${activeBrand.name} anasayfada yukarı taşındı.`);
    }
  });

  // Move brand down in homepage order
  container.querySelector('#btn-brand-move-down')?.addEventListener('click', async () => {
    const idx = menuData.brands.findIndex((b) => b.id === activeBrand.id);
    if (idx >= 0 && idx < menuData.brands.length - 1) {
      const temp = menuData.brands[idx + 1];
      menuData.brands[idx + 1] = menuData.brands[idx];
      menuData.brands[idx] = temp;
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, `${activeBrand.name} anasayfada aşağı taşındı.`);
    }
  });

  // Logout
  container.querySelector('#btn-admin-logout')?.addEventListener('click', () => {
    logoutAdmin();
    adminState.authenticated = false;
    renderAdminView(container);
  });

  // Open password modal
  container.querySelector('#btn-open-pass-modal')?.addEventListener('click', () => {
    adminState.showPasswordModal = true;
    renderDashboard(container, menuData, true);
  });

  // Close password modal
  container.querySelector('#btn-close-pass-modal')?.addEventListener('click', () => {
    adminState.showPasswordModal = false;
    renderDashboard(container, menuData, true);
  });

  // Submit password change
  container.querySelector('#change-password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const curr = container.querySelector('#curr-pass-input').value;
    const next = container.querySelector('#new-pass-input').value;
    const errEl = container.querySelector('#pass-modal-error');
    try {
      await changeAdminPassword(curr, next);
      adminState.showPasswordModal = false;
      renderDashboard(container, menuData, true);
      showToast(container, 'Parola uçtan uca şifrelenerek güncellendi.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  // Brand logo upload
  container.querySelector('#brand-logo-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast(container, 'Logo yükleniyor...');
      const uploadedUrl = await uploadImageFile(file);
      activeBrand.logo = uploadedUrl;
      await saveMenuData(menuData);

      const logoImgEl = container.querySelector('#active-brand-logo-img');
      if (logoImgEl) {
        logoImgEl.src = uploadedUrl;
      }
      e.target.value = '';
      showToast(container, `${activeBrand.name} logosu başarıyla güncellendi.`);
    } catch (err) {
      showToast(container, err.message, 'error');
    }
  });

  // Add new category
  container.querySelector('#add-category-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('#new-category-name');
    const name = input.value.trim();
    if (!name) return;
    const slug = `${activeBrand.id}-${Date.now()}`;
    activeBrand.categories.push({
      id: slug,
      name,
      products: []
    });
    try {
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, 'Yeni kategori eklendi.');
    } catch (err) {
      showToast(container, err.message, 'error');
    }
  });

  // Category Move Up
  container.querySelectorAll('[data-cat-up]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-up');
      const idx = activeBrand.categories.findIndex((c) => c.id === catId);
      if (idx > 0) {
        const temp = activeBrand.categories[idx - 1];
        activeBrand.categories[idx - 1] = activeBrand.categories[idx];
        activeBrand.categories[idx] = temp;
        await saveMenuData(menuData);
        renderDashboard(container, menuData, true);
      }
    });
  });

  // Category Move Down
  container.querySelectorAll('[data-cat-down]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-down');
      const idx = activeBrand.categories.findIndex((c) => c.id === catId);
      if (idx >= 0 && idx < activeBrand.categories.length - 1) {
        const temp = activeBrand.categories[idx + 1];
        activeBrand.categories[idx + 1] = activeBrand.categories[idx];
        activeBrand.categories[idx] = temp;
        await saveMenuData(menuData);
        renderDashboard(container, menuData, true);
      }
    });
  });

  // Category Rename
  container.querySelectorAll('[data-cat-rename]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-rename');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      if (!cat) return;
      const newName = window.prompt('Yeni kategori ismini girin:', cat.name);
      if (newName && newName.trim()) {
        cat.name = newName.trim();
        await saveMenuData(menuData);
        renderDashboard(container, menuData, true);
        showToast(container, 'Kategori adı güncellendi.');
      }
    });
  });

  // Category Delete
  container.querySelectorAll('[data-cat-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-delete');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      if (!cat) return;
      if (!window.confirm(`"${cat.name}" kategorisini ve içindeki ürünleri silmek istediğinize emin misiniz?`)) {
        return;
      }
      activeBrand.categories = activeBrand.categories.filter((c) => c.id !== catId);
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, 'Kategori silindi.');
    });
  });

  // Open Add Product Modal
  container.querySelectorAll('[data-add-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const catId = btn.getAttribute('data-add-product');
      adminState.isNewProduct = true;
      adminState.editingProduct = {
        brandId: activeBrand.id,
        categoryId: catId,
        product: {
          id: `prod-${Date.now()}`,
          name: '',
          description: '',
          price: '',
          image: '/images/tavuk-doner.svg',
          available: true
        }
      };
      renderDashboard(container, menuData, true);
    });
  });

  // Open Edit Product Modal
  container.querySelectorAll('[data-edit-prod]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prodId = btn.getAttribute('data-edit-prod');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      const prod = cat?.products.find((p) => p.id === prodId);
      if (!prod) return;
      adminState.isNewProduct = false;
      adminState.editingProduct = {
        brandId: activeBrand.id,
        categoryId: catId,
        product: { ...prod }
      };
      renderDashboard(container, menuData, true);
    });
  });

  // Open Photo & Grid Preview Crop/Position Modal when clicking product thumbnail
  container.querySelectorAll('[data-quick-photo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prodId = btn.getAttribute('data-quick-photo');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      const prod = cat?.products.find((p) => p.id === prodId);
      if (!prod) return;

      adminState.croppingProduct = {
        categoryId: catId,
        productId: prodId,
        image: prod.image,
        crop: normalizeCrop(prod.imageCrop)
      };
      renderDashboard(container, menuData, true);
    });
  });

  // Product Move Up (↑) inside category
  container.querySelectorAll('[data-prod-up]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const prodId = btn.getAttribute('data-prod-up');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      if (!cat) return;
      const idx = cat.products.findIndex((p) => p.id === prodId);
      if (idx > 0) {
        const temp = cat.products[idx - 1];
        cat.products[idx - 1] = cat.products[idx];
        cat.products[idx] = temp;
        await saveMenuData(menuData);
        renderDashboard(container, menuData, true);
        showToast(container, 'Ürün bir üst sıraya taşındı.');
      }
    });
  });

  // Product Move Down (↓) inside category
  container.querySelectorAll('[data-prod-down]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const prodId = btn.getAttribute('data-prod-down');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      if (!cat) return;
      const idx = cat.products.findIndex((p) => p.id === prodId);
      if (idx >= 0 && idx < cat.products.length - 1) {
        const temp = cat.products[idx + 1];
        cat.products[idx + 1] = cat.products[idx];
        cat.products[idx] = temp;
        await saveMenuData(menuData);
        renderDashboard(container, menuData, true);
        showToast(container, 'Ürün bir alt sıraya taşındı.');
      }
    });
  });

  // Product Drag & Drop Reordering (Desktop HTML5 Drag + Mobile Touch Handle Drag)
  let dragSourceCatId = null;
  let dragSourceIdx = -1;

  const moveProductInCategory = async (catId, fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    const cat = activeBrand.categories.find((c) => c.id === catId);
    if (!cat || !cat.products[fromIdx] || !cat.products[toIdx]) return;
    const [moved] = cat.products.splice(fromIdx, 1);
    cat.products.splice(toIdx, 0, moved);
    await saveMenuData(menuData);
    renderDashboard(container, menuData, true);
    showToast(container, `"${moved.name}" #${toIdx + 1} sırasına taşındı.`);
  };

  container.querySelectorAll('[data-prod-card]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      // Do not start drag if interacting with an input
      if (e.target.tagName === 'INPUT') {
        e.preventDefault();
        return;
      }
      dragSourceCatId = card.getAttribute('data-prod-cat');
      dragSourceIdx = Number(card.getAttribute('data-prod-idx'));
      card.style.opacity = '0.45';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      dragSourceCatId = null;
      dragSourceIdx = -1;
      container.querySelectorAll('[data-prod-card]').forEach((c) => {
        c.style.outline = '';
      });
    });

    card.addEventListener('dragover', (e) => {
      const targetCatId = card.getAttribute('data-prod-cat');
      if (!dragSourceCatId || targetCatId !== dragSourceCatId) return;
      e.preventDefault();
      card.style.outline = '2px dashed #2563EB';
    });

    card.addEventListener('dragleave', () => {
      card.style.outline = '';
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.style.outline = '';
      const targetCatId = card.getAttribute('data-prod-cat');
      const targetIdx = Number(card.getAttribute('data-prod-idx'));
      if (dragSourceCatId && targetCatId === dragSourceCatId && dragSourceIdx !== targetIdx) {
        await moveProductInCategory(targetCatId, dragSourceIdx, targetIdx);
      }
    });
  });

  // Touch / Pointer Drag on the "⠿ #1" handle for mobile phones & tablets
  container.querySelectorAll('[data-drag-handle]').forEach((handle) => {
    let touchCatId = null;
    let touchFromIdx = -1;
    let touchTargetCard = null;
    let sourceCardEl = null;

    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // Mouse uses native HTML5 drag on the card
      sourceCardEl = handle.closest('[data-prod-card]');
      if (!sourceCardEl) return;
      touchCatId = sourceCardEl.getAttribute('data-prod-cat');
      touchFromIdx = Number(sourceCardEl.getAttribute('data-prod-idx'));
      sourceCardEl.style.opacity = '0.5';
      handle.setPointerCapture?.(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (touchFromIdx < 0 || !touchCatId) return;
      const elUnderFinger = document.elementFromPoint(e.clientX, e.clientY);
      const candidateCard = elUnderFinger?.closest('[data-prod-card]');

      container.querySelectorAll('[data-prod-card]').forEach((c) => {
        c.style.outline = '';
      });

      if (candidateCard && candidateCard.getAttribute('data-prod-cat') === touchCatId) {
        touchTargetCard = candidateCard;
        candidateCard.style.outline = '2px dashed #2563EB';
      } else {
        touchTargetCard = null;
      }
    });

    const finishTouchDrag = async () => {
      if (sourceCardEl) sourceCardEl.style.opacity = '';
      container.querySelectorAll('[data-prod-card]').forEach((c) => {
        c.style.outline = '';
      });
      if (touchTargetCard && touchCatId) {
        const toIdx = Number(touchTargetCard.getAttribute('data-prod-idx'));
        const catId = touchCatId;
        const fromIdx = touchFromIdx;
        touchCatId = null;
        touchFromIdx = -1;
        touchTargetCard = null;
        if (fromIdx !== toIdx) {
          await moveProductInCategory(catId, fromIdx, toIdx);
        }
      } else {
        touchCatId = null;
        touchFromIdx = -1;
        touchTargetCard = null;
      }
    };

    handle.addEventListener('pointerup', finishTouchDrag);
    handle.addEventListener('pointercancel', finishTouchDrag);
  });

  // Quick 1-Click Price Edit Shortcut
  container.querySelectorAll('[data-quick-price]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prodId = btn.getAttribute('data-quick-price');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      const prod = cat?.products.find((p) => p.id === prodId);
      if (!prod) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'inline-flex items-center gap-1';
      wrapper.innerHTML = `
        <input
          type="text"
          inputmode="decimal"
          value="${escapeHtml(stripCurrency(prod.price))}"
          class="w-16 px-2 py-0.5 text-xs cal-bold text-neutral-900 bg-white rounded border-2 border-blue-600 focus:outline-none"
        />
        <span class="text-xs cal-bold text-neutral-600">₺</span>
      `;

      const inputEl = wrapper.querySelector('input');
      btn.replaceWith(wrapper);
      inputEl.focus();
      inputEl.select();

      let saved = false;
      const commitPrice = async () => {
        if (saved) return;
        saved = true;
        const rawVal = stripCurrency(inputEl.value);
        if (rawVal && formatPrice(rawVal) !== formatPrice(prod.price)) {
          prod.price = formatPrice(rawVal);
          try {
            await saveMenuData(menuData);
            showToast(container, `"${prod.name}" fiyatı ${prod.price} olarak güncellendi.`);
          } catch (err) {
            showToast(container, err.message, 'error');
          }
        }
        renderDashboard(container, menuData, true);
      };

      inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commitPrice();
        } else if (ev.key === 'Escape') {
          saved = true;
          renderDashboard(container, menuData, true);
        }
      });

      inputEl.addEventListener('blur', () => {
        commitPrice();
      });
    });
  });

  // Toggle Product Availability
  container.querySelectorAll('[data-toggle-prod]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const prodId = btn.getAttribute('data-toggle-prod');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      const prod = cat?.products.find((p) => p.id === prodId);
      if (!prod) return;
      prod.available = prod.available === false ? true : false;
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, prod.available ? 'Ürün menüde aktif edildi.' : 'Ürün menüde gizlendi.');
    });
  });

  // Delete Product
  container.querySelectorAll('[data-del-prod]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const prodId = btn.getAttribute('data-del-prod');
      const catId = btn.getAttribute('data-cat-id');
      const cat = activeBrand.categories.find((c) => c.id === catId);
      const prod = cat?.products.find((p) => p.id === prodId);
      if (!prod) return;
      if (!window.confirm(`"${prod.name}" ürününü silmek istediğinize emin misiniz?`)) return;
      cat.products = cat.products.filter((p) => p.id !== prodId);
      await saveMenuData(menuData);
      renderDashboard(container, menuData, true);
      showToast(container, 'Ürün silindi.');
    });
  });

  // Photo Crop & Grid Preview Modal Events
  if (adminState.croppingProduct) {
    const closeCropModal = () => {
      adminState.croppingProduct = null;
      renderDashboard(container, menuData, true);
    };

    container.querySelector('#btn-close-crop-modal')?.addEventListener('click', closeCropModal);
    container.querySelector('#btn-cancel-crop-modal')?.addEventListener('click', closeCropModal);

    const previewImg = container.querySelector('#crop-preview-img');
    const interactiveArea = container.querySelector('#crop-interactive-area');
    const zoomSlider = container.querySelector('#crop-zoom-slider');
    const xSlider = container.querySelector('#crop-x-slider');
    const ySlider = container.querySelector('#crop-y-slider');
    const zoomVal = container.querySelector('#crop-zoom-val');
    const xVal = container.querySelector('#crop-x-val');
    const yVal = container.querySelector('#crop-y-val');
    const btnFitCover = container.querySelector('#btn-fit-cover');
    const btnFitContain = container.querySelector('#btn-fit-contain');

    const updateLivePreview = () => {
      const c = normalizeCrop(adminState.croppingProduct.crop);
      adminState.croppingProduct.crop = c;
      if (previewImg) {
        previewImg.style.cssText = getProductImageStyle(c);
      }
      if (zoomSlider) zoomSlider.value = String(c.zoom);
      if (xSlider) xSlider.value = String(c.x);
      if (ySlider) ySlider.value = String(c.y);
      if (zoomVal) zoomVal.textContent = `${Math.round(c.zoom * 100)}%`;
      if (xVal) xVal.textContent = `${c.x}%`;
      if (yVal) yVal.textContent = `${c.y}%`;
      if (btnFitCover && btnFitContain) {
        btnFitCover.style.cssText =
          c.fit === 'cover' ? 'background-color:#141413;color:#FFFFFF;' : 'color:#404040;';
        btnFitContain.style.cssText =
          c.fit === 'contain' ? 'background-color:#141413;color:#FFFFFF;' : 'color:#404040;';
      }
    };

    zoomSlider?.addEventListener('input', () => {
      adminState.croppingProduct.crop.zoom = Number(zoomSlider.value);
      updateLivePreview();
    });

    xSlider?.addEventListener('input', () => {
      adminState.croppingProduct.crop.x = Number(xSlider.value);
      updateLivePreview();
    });

    ySlider?.addEventListener('input', () => {
      adminState.croppingProduct.crop.y = Number(ySlider.value);
      updateLivePreview();
    });

    btnFitCover?.addEventListener('click', () => {
      adminState.croppingProduct.crop.fit = 'cover';
      updateLivePreview();
    });

    btnFitContain?.addEventListener('click', () => {
      adminState.croppingProduct.crop.fit = 'contain';
      updateLivePreview();
    });

    container.querySelector('#btn-crop-reset')?.addEventListener('click', () => {
      adminState.croppingProduct.crop = { x: 0, y: 0, zoom: 1, fit: 'cover' };
      updateLivePreview();
    });

    // Pointer drag (works with both Finger Touch on mobile and Mouse on desktop)
    let isDragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startCropX = 0;
    let startCropY = 0;

    interactiveArea?.addEventListener('pointerdown', (e) => {
      isDragging = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startCropX = Number(adminState.croppingProduct.crop.x) || 0;
      startCropY = Number(adminState.croppingProduct.crop.y) || 0;
      interactiveArea.style.cursor = 'grabbing';
      interactiveArea.setPointerCapture?.(e.pointerId);
    });

    interactiveArea?.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = interactiveArea.getBoundingClientRect();
      const deltaXPercent = ((e.clientX - startClientX) / (rect.width || 180)) * 100;
      const deltaYPercent = ((e.clientY - startClientY) / (rect.height || 125)) * 100;

      adminState.croppingProduct.crop.x = Math.max(-100, Math.min(100, Math.round(startCropX + deltaXPercent)));
      adminState.croppingProduct.crop.y = Math.max(-100, Math.min(100, Math.round(startCropY + deltaYPercent)));
      updateLivePreview();
    });

    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      if (interactiveArea) interactiveArea.style.cursor = 'grab';
    };
    interactiveArea?.addEventListener('pointerup', stopDrag);
    interactiveArea?.addEventListener('pointercancel', stopDrag);

    // Upload new photo directly inside the crop modal
    container.querySelector('#crop-modal-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        showToast(container, 'Yeni fotoğraf yükleniyor...');
        const uploadedUrl = await uploadImageFile(file);
        adminState.croppingProduct.image = uploadedUrl;
        adminState.croppingProduct.crop = { x: 0, y: 0, zoom: 1, fit: 'cover' };
        if (previewImg) {
          previewImg.src = uploadedUrl;
        }
        updateLivePreview();
        e.target.value = '';
        showToast(container, 'Fotoğraf yüklendi! Şimdi kart üzerindeki konumunu ayarlayıp kaydedebilirsiniz.');
      } catch (err) {
        showToast(container, err.message, 'error');
      }
    });

    // Save Crop & Photo changes
    container.querySelector('#btn-save-crop-modal')?.addEventListener('click', async () => {
      const { categoryId, productId, image, crop } = adminState.croppingProduct;
      const cat = activeBrand.categories.find((c) => c.id === categoryId);
      const prod = cat?.products.find((p) => p.id === productId);
      if (!prod) return;

      const saveBtn = container.querySelector('#btn-save-crop-modal');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Kaydediliyor...';
      }

      prod.image = image;
      prod.imageCrop = normalizeCrop(crop);

      try {
        await saveMenuData(menuData);
        adminState.croppingProduct = null;
        renderDashboard(container, menuData, true);
        showToast(container, `"${prod.name}" kart görünümü kaydedildi.`);
      } catch (err) {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Görünümü Kaydet';
        }
        showToast(container, err.message, 'error');
      }
    });
  }

  // Product Modal Events
  if (adminState.editingProduct) {
    const closeModal = () => {
      adminState.editingProduct = null;
      renderDashboard(container, menuData, true);
    };
    container.querySelector('#btn-close-prod-modal')?.addEventListener('click', closeModal);
    container.querySelector('#btn-cancel-prod-modal')?.addEventListener('click', closeModal);

    // Image upload inside product modal
    const fileInput = container.querySelector('#prod-image-file');
    const urlInput = container.querySelector('#prod-image-url');
    const previewImg = container.querySelector('#prod-image-preview');

    urlInput?.addEventListener('input', () => {
      previewImg.src = urlInput.value;
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        showToast(container, 'Fotoğraf yükleniyor...');
        const uploadedUrl = await uploadImageFile(file);
        urlInput.value = uploadedUrl;
        previewImg.src = uploadedUrl;
        showToast(container, 'Fotoğraf yüklendi.');
      } catch (err) {
        showToast(container, err.message, 'error');
      }
    });

    // Save Product Form
    container.querySelector('#product-modal-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetCatId = container.querySelector('#prod-category-select').value;
      const updatedProduct = {
        id: adminState.editingProduct.product.id,
        name: container.querySelector('#prod-name-input').value.trim(),
        description: container.querySelector('#prod-desc-input').value.trim(),
        price: formatPrice(container.querySelector('#prod-price-input').value),
        image: container.querySelector('#prod-image-url').value.trim() || '/images/tavuk-doner.svg',
        imageCrop: adminState.editingProduct.product.imageCrop,
        available: container.querySelector('#prod-available-check').checked
      };

      const originalCat = activeBrand.categories.find((c) => c.id === adminState.editingProduct.categoryId);
      const targetCat = activeBrand.categories.find((c) => c.id === targetCatId);

      if (!targetCat) return;

      if (adminState.isNewProduct) {
        targetCat.products.push(updatedProduct);
      } else if (originalCat && originalCat.id === targetCat.id) {
        const idx = originalCat.products.findIndex((p) => p.id === updatedProduct.id);
        if (idx !== -1) originalCat.products[idx] = updatedProduct;
      } else if (originalCat) {
        originalCat.products = originalCat.products.filter((p) => p.id !== updatedProduct.id);
        targetCat.products.push(updatedProduct);
      }

      try {
        await saveMenuData(menuData);
        adminState.editingProduct = null;
        renderDashboard(container, menuData, true);
        showToast(container, 'Ürün başarıyla kaydedildi.');
      } catch (err) {
        showToast(container, err.message, 'error');
      }
    });
  }
}

