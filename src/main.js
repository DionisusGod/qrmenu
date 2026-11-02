import { fetchMenuData, logoutAdmin } from './services/menuService.js';

const appEl = document.getElementById('app');

// Preserve scroll position per brand menu so returning from Product Detail is instant
const brandScrollPositions = new Map();
let activeScrollCleanup = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(price) {
  const cleaned = String(price ?? '')
    .replace(/₺/g, '')
    .replace(/\bTL\b/gi, '')
    .trim();
  return cleaned ? `${cleaned} ₺` : '';
}

function getProductImageStyle(crop) {
  if (!crop) return '';
  const x = Number(crop.x) || 0;
  const y = Number(crop.y) || 0;
  const zoom = Number(crop.zoom) || 1;
  const fit = crop.fit === 'contain' ? 'contain' : 'cover';
  return `object-fit: ${fit}; transform: translate(${x}%, ${y}%) scale(${zoom}); transform-origin: center center;`;
}

function parseRoute() {
  const pathname = window.location.pathname;
  const hash = window.location.hash.replace(/^#\/?/, '');

  if (pathname === '/admin' || hash === 'admin' || hash.startsWith('admin/')) {
    return { view: 'admin' };
  }

  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'marka' && parts[1] && parts[2] === 'urun' && parts[3]) {
    return {
      view: 'product',
      brandId: decodeURIComponent(parts[1]),
      productId: decodeURIComponent(parts[3])
    };
  }

  if (parts[0] === 'marka' && parts[1]) {
    return {
      view: 'brand',
      brandId: decodeURIComponent(parts[1])
    };
  }

  return { view: 'home' };
}

function navigateTo(hashPath) {
  if (window.location.pathname === '/admin' && !hashPath.includes('admin')) {
    window.history.pushState(null, '', `/#${hashPath}`);
    handleRouteChange();
    return;
  }
  window.location.hash = hashPath;
}

// ============================================================================
// A. ANASAYFA (4 Marka Seçimi - Gölgeli ve Ferah Aralıklı Cardboard Grid)
// ============================================================================
function renderHomeView(menuData) {
  const brands = menuData.brands || [];

  appEl.innerHTML = `
    <main class="w-full max-w-md mx-auto h-dvh overflow-hidden bg-offwhite grid grid-rows-4 gap-4 p-5 select-none">
      ${brands
        .slice(0, 4)
        .map(
          (brand, idx) => `
        <button
          type="button"
          data-brand-id="${escapeHtml(brand.id)}"
          aria-label="${escapeHtml(brand.name)} Menüsü"
          class="brand-card w-full h-full rounded-2xl p-0 m-0 border-0 outline-none cursor-pointer overflow-hidden relative block"
        >
          <img
            src="${escapeHtml(brand.logo)}"
            alt="${escapeHtml(brand.name)}"
            ${idx < 2 ? 'fetchpriority="high"' : 'loading="eager"'}
            decoding="async"
            class="w-full h-full object-cover object-center scale-[1.015] block pointer-events-none"
          />
        </button>
      `
        )
        .join('')}
    </main>
  `;

  appEl.querySelectorAll('[data-brand-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const brandId = btn.getAttribute('data-brand-id');
      brandScrollPositions.set(brandId, 0);
      navigateTo(`/marka/${encodeURIComponent(brandId)}`);
    });
  });
}

// ============================================================================
// B. MARKA MENÜ SAYFASI (Sticky Kategori Barı + 2x3 Cardboard Ürün Grid)
// ============================================================================
function renderBrandMenuView(menuData, brandId) {
  const brand = (menuData.brands || []).find((b) => b.id === brandId);
  if (!brand) {
    navigateTo('/');
    return;
  }

  // Only show categories that have at least one available product (or show all categories with active products filtered)
  const visibleCategories = (brand.categories || []).map((cat) => ({
    ...cat,
    activeProducts: (cat.products || []).filter((p) => p.available !== false)
  }));

  const totalActiveProducts = visibleCategories.reduce(
    (sum, cat) => sum + cat.activeProducts.length,
    0
  );

  if (visibleCategories.length === 0 || totalActiveProducts === 0) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    appEl.innerHTML = `
      <div class="w-full max-w-md mx-auto min-h-dvh bg-offwhite flex flex-col justify-between p-5 view-enter select-none">
        <header class="flex items-center">
          <button
            type="button"
            id="btn-back-home"
            aria-label="Marka Seçimine Dön"
            class="w-10 h-10 rounded-full bg-white/90 shadow-xs flex items-center justify-center active:scale-90 transition cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#141413" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </header>

        <main class="flex-1 flex flex-col items-center justify-center text-center px-3">
          <div class="w-full bg-white rounded-3xl p-8 shadow-[0_8px_28px_rgba(20,20,19,0.08)] border border-black/[0.03] flex flex-col items-center space-y-4">
            <div class="w-16 h-16 rounded-2xl bg-offwhite flex items-center justify-center text-3xl">
              🚧
            </div>
            <h1 class="text-xl leading-snug cal-bold text-neutral-900">
              Bu sayfa şu anda yapım aşamasında!
            </h1>
            <p class="text-sm cal-normal text-neutral-600 leading-relaxed">
              ${escapeHtml(brand.name)} menüsü çok yakında burada yerini alacak.
            </p>
            <button
              type="button"
              id="btn-back-home-card"
              style="background-color: #141413; color: #FFFFFF;"
              class="mt-2 px-6 py-3 rounded-xl text-xs cal-bold active:scale-95 transition cursor-pointer shadow-xs"
            >
              ← Diğer Markalara Göz At
            </button>
          </div>
        </main>

        <div class="h-10"></div>
      </div>
    `;

    const goHome = () => {
      brandScrollPositions.set(brandId, 0);
      navigateTo('/');
    };
    appEl.querySelector('#btn-back-home')?.addEventListener('click', goHome);
    appEl.querySelector('#btn-back-home-card')?.addEventListener('click', goHome);
    return;
  }

  const firstCatId = visibleCategories[0]?.id || '';

  appEl.innerHTML = `
    <div class="w-full max-w-md mx-auto min-h-dvh bg-offwhite pb-10 view-enter">
      <!-- Sticky Swipeable Category Navigation Bar -->
      <header
        id="sticky-category-header"
        class="sticky top-0 z-30 w-full bg-offwhite/95 backdrop-blur-md border-b border-black/[0.05]"
      >
        <div class="flex items-center h-14 px-3 gap-1.5">
          <button
            type="button"
            id="btn-back-home"
            aria-label="Marka Seçimine Dön"
            class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <nav
            id="category-nav-scroll"
            class="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth py-1.5 pr-2 flex-1"
          >
            ${visibleCategories
              .map(
                (cat, index) => `
              <button
                type="button"
                data-cat-pill="${escapeHtml(cat.id)}"
                class="cat-pill shrink-0 px-3.5 py-1.5 rounded-full text-sm cal-bold whitespace-nowrap transition-all duration-150 cursor-pointer ${
                  index === 0
                    ? 'bg-neutral-900 !text-white shadow-xs'
                    : 'bg-transparent text-neutral-700 opacity-70 hover:opacity-100'
                }"
              >
                ${escapeHtml(cat.name)}
              </button>
            `
              )
              .join('')}
          </nav>
        </div>
      </header>

      <!-- Categories & 2-Column x 3-Row Cardboard Product Grid -->
      <main class="px-3.5 pt-3 space-y-6">
        ${visibleCategories
          .map(
            (cat) => `
          <section
            id="cat-section-${escapeHtml(cat.id)}"
            data-cat-section="${escapeHtml(cat.id)}"
            class="scroll-mt-16"
          >
            <h2 class="text-base cal-bold mb-2.5 px-0.5">${escapeHtml(cat.name)}</h2>
            ${
              cat.activeProducts.length === 0
                ? `<p class="text-xs cal-normal py-4 px-1">Bu kategoride ürün bulunmuyor.</p>`
                : `<div class="grid grid-cols-2 gap-3">
                    ${cat.activeProducts
                      .map(
                        (prod) => `
                      <article
                        data-product-card="${escapeHtml(prod.id)}"
                        class="product-card rounded-2xl overflow-hidden flex flex-col cursor-pointer select-none border border-black/[0.03]"
                      >
                        <div class="w-full h-[57%] bg-neutral-100/60 overflow-hidden shrink-0">
                          <img
                            src="${escapeHtml(prod.image)}"
                            alt="${escapeHtml(prod.name)}"
                            loading="lazy"
                            decoding="async"
                            style="${escapeHtml(getProductImageStyle(prod.imageCrop))}"
                            class="w-full h-full object-cover"
                          />
                        </div>
                        <div class="flex-1 flex flex-col justify-between p-2.5 min-h-0">
                          <div class="min-w-0">
                            <h3 class="text-[13.5px] leading-tight cal-bold truncate">${escapeHtml(prod.name)}</h3>
                            <p class="text-[11.5px] leading-snug cal-normal italic opacity-60 truncate mt-0.5">
                              ${escapeHtml(prod.description || '')}
                            </p>
                          </div>
                          <div class="text-[13px] cal-normal pt-1">${escapeHtml(formatPrice(prod.price))}</div>
                        </div>
                      </article>
                    `
                      )
                      .join('')}
                  </div>`
            }
          </section>
        `
          )
          .join('')}
      </main>
    </div>
  `;

  // Restore saved scroll position if returning from Product Detail
  const savedScrollY = brandScrollPositions.get(brandId) || 0;
  if (savedScrollY > 0) {
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    });
  } else {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Back to Home button
  appEl.querySelector('#btn-back-home')?.addEventListener('click', () => {
    brandScrollPositions.set(brandId, 0);
    navigateTo('/');
  });

  // Product card click -> Save current scroll position and open Product Detail
  appEl.querySelectorAll('[data-product-card]').forEach((card) => {
    card.addEventListener('click', () => {
      brandScrollPositions.set(brandId, window.scrollY);
      const productId = card.getAttribute('data-product-card');
      navigateTo(`/marka/${encodeURIComponent(brandId)}/urun/${encodeURIComponent(productId)}`);
    });
  });

  // Category Pill Smooth Scroll & Scroll-Spy
  setupCategoryScrollSpy(firstCatId);
}

function setupCategoryScrollSpy(initialCatId) {
  const navEl = appEl.querySelector('#category-nav-scroll');
  const pills = Array.from(appEl.querySelectorAll('[data-cat-pill]'));
  const sections = Array.from(appEl.querySelectorAll('[data-cat-section]'));
  if (!navEl || pills.length === 0 || sections.length === 0) return;

  let activeCatId = initialCatId;
  let isProgrammaticScroll = false;
  let scrollTimeout = null;

  function setActivePill(catId) {
    if (!catId || activeCatId === catId) return;
    activeCatId = catId;

    pills.forEach((pill) => {
      const id = pill.getAttribute('data-cat-pill');
      if (id === catId) {
        pill.className =
          'cat-pill shrink-0 px-3.5 py-1.5 rounded-full text-sm cal-bold whitespace-nowrap transition-all duration-150 cursor-pointer bg-neutral-900 !text-white shadow-xs';
        // Center active pill horizontally inside the sticky category bar
        const pillLeft = pill.offsetLeft;
        const pillWidth = pill.offsetWidth;
        const navWidth = navEl.clientWidth;
        navEl.scrollTo({
          left: Math.max(0, pillLeft - navWidth / 2 + pillWidth / 2),
          behavior: 'smooth'
        });
      } else {
        pill.className =
          'cat-pill shrink-0 px-3.5 py-1.5 rounded-full text-sm cal-bold whitespace-nowrap transition-all duration-150 cursor-pointer bg-transparent text-neutral-700 opacity-70 hover:opacity-100';
      }
    });
  }

  // Click on category pill -> smooth scroll to section
  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const targetId = pill.getAttribute('data-cat-pill');
      const section = document.getElementById(`cat-section-${targetId}`);
      if (!section) return;

      isProgrammaticScroll = true;
      setActivePill(targetId);

      const headerHeight = 62;
      const top = section.getBoundingClientRect().top + window.scrollY - headerHeight;
      window.scrollTo({ top, behavior: 'smooth' });

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isProgrammaticScroll = false;
      }, 550);
    });
  });

  // Passive 60fps scroll listener for accurate Scroll-Spy
  const onScroll = () => {
    if (isProgrammaticScroll) return;
    const offset = 96;
    let currentId = sections[0]?.getAttribute('data-cat-section');

    for (const sec of sections) {
      const rect = sec.getBoundingClientRect();
      if (rect.top <= offset) {
        currentId = sec.getAttribute('data-cat-section');
      } else {
        break;
      }
    }
    if (currentId) {
      setActivePill(currentId);
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  activeScrollCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    clearTimeout(scrollTimeout);
  };
}

// ============================================================================
// C. ÜRÜN DETAY SAYFASI (Doğal Oran Fotoğraf + Bold İsim + Normal Açıklama + Normal Fiyat)
// ============================================================================
function renderProductDetailView(menuData, brandId, productId) {
  const brand = (menuData.brands || []).find((b) => b.id === brandId);
  if (!brand) {
    navigateTo('/');
    return;
  }

  let foundProduct = null;
  for (const cat of brand.categories || []) {
    const match = (cat.products || []).find((p) => p.id === productId);
    if (match) {
      foundProduct = match;
      break;
    }
  }

  if (!foundProduct) {
    navigateTo(`/marka/${encodeURIComponent(brandId)}`);
    return;
  }

  window.scrollTo({ top: 0, behavior: 'instant' });

  appEl.innerHTML = `
    <div class="w-full max-w-md mx-auto min-h-dvh bg-offwhite flex flex-col view-enter">
      <!-- Top Product Image (Natural Aspect Ratio, Uncropped Full Width) -->
      <div class="relative w-full bg-neutral-200/40 overflow-hidden shrink-0">
        <img
          src="${escapeHtml(foundProduct.image)}"
          alt="${escapeHtml(foundProduct.name)}"
          fetchpriority="high"
          decoding="async"
          class="w-full h-auto max-h-[65dvh] object-contain block"
        />
        <button
          type="button"
          id="btn-back-brand"
          aria-label="Menüye Geri Dön"
          class="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow-sm flex items-center justify-center active:scale-90 transition cursor-pointer"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#141413" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      <!-- Product Details: 1. Ürün İsmi (Bold) -> 2. Ürün Açıklaması (Normal) -> 3. Fiyat (Normal) -->
      <section class="flex-1 px-6 pt-6 pb-10 flex flex-col justify-between">
        <div class="space-y-3.5">
          <h1 class="text-2xl leading-snug cal-bold">${escapeHtml(foundProduct.name)}</h1>
          <p class="text-[15px] leading-relaxed cal-normal">${escapeHtml(foundProduct.description || '')}</p>
          <div class="pt-2">
            <span class="text-xl cal-normal">${escapeHtml(formatPrice(foundProduct.price))}</span>
          </div>
        </div>
      </section>
    </div>
  `;

  appEl.querySelector('#btn-back-brand')?.addEventListener('click', () => {
    navigateTo(`/marka/${encodeURIComponent(brandId)}`);
  });
}

// ============================================================================
// ROUTER & INITIALIZATION
// ============================================================================
async function handleRouteChange() {
  if (activeScrollCleanup) {
    activeScrollCleanup();
    activeScrollCleanup = null;
  }

  const route = parseRoute();

  // Lazy-load admin bundle only when /#admin or /admin is visited (0 KB overhead for customers!)
  if (route.view === 'admin') {
    const { renderAdminView } = await import('./admin.js');
    await renderAdminView(appEl);
    return;
  }

  const menuData = await fetchMenuData();

  if (route.view === 'brand') {
    renderBrandMenuView(menuData, route.brandId);
  } else if (route.view === 'product') {
    renderProductDetailView(menuData, route.brandId, route.productId);
  } else {
    renderHomeView(menuData);
  }
}

window.addEventListener('hashchange', handleRouteChange);
window.addEventListener('popstate', handleRouteChange);

handleRouteChange();

