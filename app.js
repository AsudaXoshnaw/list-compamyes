const $ = (s) => document.querySelector(s);
const grid = $('#grid'), dialog = $('#detail');
const PAGE_SIZE = 12;

const I18N = {
  ku: {
    brandTitle: 'ئەنجوومەنی هەولێر',
    brandSub: 'ڕێبەری کۆمپانیاکان',
    officialLink: 'سەرچاوەی فەرمی ↗',
    heroTitle: 'کۆمپانیاکانی هەولێر',
    heroSub: 'زانیارییە سەرەکییەکانی ئەندامان بە شێوەیەکی سادە و ئاسان بگەڕێ.',
    searchPlaceholder: 'بە ناو، چالاکی، بەڕێوەبەر یان شوێن بگەڕێ...',
    refresh: 'نوێکردنەوەی داتا',
    copyAll: 'کۆپی لیست',
    exportBtn: 'هەناردەی Excel',
    allCategories: 'هەموو پۆلەکان',
    allStatuses: 'هەموو دۆخەکان',
    sortName: 'ناو (A-Z)',
    sortMembership: 'نوێترین ئەندامێتی',
    countSuffix: 'کۆمپانیا پیشان دەدرێت',
    updatedPrefix: 'نوێکراوەتەوە',
    closeLabel: 'داخستن',
    more: 'زیاتر',
    fManager: 'MANAGER', fTitle: 'TITLE', fLocation: 'LOCATION', fPhone: 'PHONE', fEmail: 'EMAIL',
    fMembership: 'MEMBERSHIP', fEndDate: 'END DATE', fCategory: 'CATEGORY', fActivities: 'ACTIVITIES',
    mapBtn: '⌖ کردنەوە لە Maps',
    copyPhoneBtn: '☎ کۆپی‌کردنی ژمارە',
    copyInfoBtn: '⧉ کۆپی هەموو زانیاری',
    sourceLink: 'سەرچاوەی فەرمی ↗',
    copiedToast: 'زانیارییەکان کۆپی کران',
    noBackendToast: 'backendی زیندوو بەردەست نییە؛ داتای هەڵگیراوی پێشوو پیشان دەدرێت',
    progressList: (p, c) => `پەیجی ${p ?? '?'} ... ${c} کۆمپانیا خوێندرایەوە`,
    progressDetail: (i, t) => `وردەکاری کۆمپانیا ${i} لە ${t}`,
    src: { cache: 'cache', 'cache-fallback': 'cache (fallback)', live: 'live', 'static-file': 'saved snapshot' },
  },
  ar: {
    brandTitle: 'غرفة تجارة أربيل',
    brandSub: 'دليل الشركات',
    officialLink: 'المصدر الرسمي ↗',
    heroTitle: 'شركات أربيل',
    heroSub: 'تصفح المعلومات الأساسية للأعضاء بطريقة سهلة وبسيطة.',
    searchPlaceholder: 'ابحث بالاسم أو النشاط أو المدير أو الموقع...',
    refresh: 'تحديث البيانات',
    copyAll: 'نسخ القائمة',
    exportBtn: 'تصدير إلى Excel',
    allCategories: 'كل الفئات',
    allStatuses: 'كل الحالات',
    sortName: 'الاسم (A-Z)',
    sortMembership: 'أحدث عضوية',
    countSuffix: 'شركة معروضة',
    updatedPrefix: 'آخر تحديث',
    closeLabel: 'إغلاق',
    more: 'المزيد',
    fManager: 'المدير', fTitle: 'المنصب', fLocation: 'الموقع', fPhone: 'الهاتف', fEmail: 'البريد الإلكتروني',
    fMembership: 'بداية العضوية', fEndDate: 'تاريخ الانتهاء', fCategory: 'الفئة', fActivities: 'الأنشطة',
    mapBtn: '⌖ فتح الموقع في خرائط Google',
    copyPhoneBtn: '☎ نسخ الرقم',
    copyInfoBtn: '⧉ نسخ كل المعلومات',
    sourceLink: 'المصدر الرسمي ↗',
    copiedToast: 'تم نسخ المعلومات',
    noBackendToast: 'الخادم المباشر غير متاح؛ يتم عرض آخر بيانات محفوظة',
    progressList: (p, c) => `الصفحة ${p ?? '?'} ... تمت قراءة ${c} شركة`,
    progressDetail: (i, t) => `تفاصيل الشركة ${i} من ${t}`,
    src: { cache: 'مخزّن مؤقتًا', 'cache-fallback': 'مخزّن (احتياطي)', live: 'مباشر', 'static-file': 'نسخة محفوظة' },
  },
};

let lang = 'ku';
try { lang = localStorage.getItem('ecc_lang') || 'ku'; } catch (e) { /* private mode etc. */ }
function t(key) { return I18N[lang][key]; }

let companies = [];
let activePage = 1;
let currentItems = [];
let pollTimer = null;

function dash(v) {
  return v && String(v).trim() && v !== '—' ? v : '—';
}

function parseKurdishDate(s) {
  // dates look like "15/ 09/ 2026" (dd/mm/yyyy with stray spaces)
  if (!s || s === '—') return 0;
  const m = String(s).match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
  if (!m) return 0;
  const [, d, mo, y] = m;
  return new Date(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`).getTime() || 0;
}

function populateFilters() {
  const categories = new Set(), statuses = new Set();
  companies.forEach((c) => {
    if (c.category && c.category !== '—') categories.add(c.category);
    if (c.status && c.status !== '—') statuses.add(c.status);
  });
  const catSel = $('#categoryFilter'), statSel = $('#statusFilter');
  const prevCat = catSel.value, prevStat = statSel.value;
  catSel.innerHTML = `<option value="">${t('allCategories')}</option>` +
    [...categories].sort().map((c) => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
  statSel.innerHTML = `<option value="">${t('allStatuses')}</option>` +
    [...statuses].sort().map((c) => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
  catSel.value = prevCat;
  statSel.value = prevStat;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function applyFilters() {
  const q = $('#search').value.toLowerCase();
  const cat = $('#categoryFilter').value;
  const status = $('#statusFilter').value;
  const sortBy = $('#sortBy').value;

  let items = companies.filter((c) => {
    const hay = `${c.companyName} ${c.activities} ${c.manager} ${c.location}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (cat && c.category !== cat) return false;
    if (status && c.status !== status) return false;
    return true;
  });

  if (sortBy === 'membership') {
    items = items.slice().sort((a, b) => parseKurdishDate(b.membershipDate) - parseKurdishDate(a.membershipDate));
  } else {
    items = items.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));
  }

  activePage = 1;
  render(items);
}

function render(items = currentItems) {
  currentItems = items;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (activePage > totalPages) activePage = totalPages;
  const shown = items.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);

  $('#count').textContent = `${items.length} ${t('countSuffix')}`;

  grid.innerHTML = shown.map((c) => `
    <article class="card">
      <span class="badge">${dash(c.status)}</span>
      <div class="globe">◎</div>
      <h2>${c.companyName}</h2>
      <p>${dash(c.activities)}</p>
      <button class="more" data-id="${c.id}">${t('more')}</button>
    </article>
  `).join('');

  document.querySelectorAll('.more').forEach((b) => {
    b.onclick = () => show(companies.find((c) => c.id === b.dataset.id));
  });

  $('#pagination').innerHTML = Array.from({ length: totalPages }, (_, i) => i + 1)
    .map((p) => `<button class="page ${p === activePage ? 'selected' : ''}" data-page="${p}">${p}</button>`)
    .join('');
  document.querySelectorAll('.page').forEach((b) => {
    b.onclick = () => { activePage = +b.dataset.page; render(currentItems); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  });
}

function show(c) {
  $('#detailBody').innerHTML = `
    <div class="detail-wrap">
      <div class="detail-head">
        <div class="avatar">${c.imageUrl && c.imageUrl !== '—' ? `<img src="${c.imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:18px" onerror="this.remove()">` : '◎'}</div>
        <div><h2>${c.companyName}</h2><p>${dash(c.activities)}</p></div>
        <span class="status">${dash(c.status)}</span>
      </div>
      <div class="info">
        <div class="field"><b>${t('fManager')}</b><span>${dash(c.manager)}</span></div>
        <div class="field"><b>${t('fTitle')}</b><span>${dash(c.managerTitle)}</span></div>
        <div class="field"><b>${t('fLocation')}</b><span>${dash(c.location)}</span></div>
        <div class="field"><b>${t('fPhone')}</b><span>${dash(c.phone)}</span></div>
        <div class="field"><b>${t('fEmail')}</b><span>${dash(c.email)}</span></div>
        <div class="field"><b>${t('fMembership')}</b><span>${dash(c.membershipDate)}</span></div>
        <div class="field"><b>${t('fEndDate')}</b><span>${dash(c.endDate)}</span></div>
        <div class="field"><b>${t('fCategory')}</b><span>${dash(c.category)}</span></div>
      </div>
      <section class="activities">
        <h3>${t('fActivities')}</h3>
        <div class="chips">${dash(c.activities).split(',').map((x) => `<span class="chip">${x.trim()}</span>`).join('')}</div>
      </section>
      <div class="detail-actions">
        <button class="map" id="map">${t('mapBtn')}</button>
        <button class="copy" id="copyPhone">${t('copyPhoneBtn')}</button>
        <button class="copy" id="copyInfo">${t('copyInfoBtn')}</button>
        <a class="copy" target="_blank" href="${c.sourceUrl}">${t('sourceLink')}</a>
      </div>
    </div>
  `;
  dialog.showModal();

  $('#map').onclick = () => window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.location !== '—' ? c.location : c.companyName + ' Erbil'), '_blank');
  $('#copyPhone').onclick = () => copy(c.phone !== '—' ? c.phone : '');
  $('#copyInfo').onclick = () => copy(
    `${c.companyName}\nManager: ${c.manager} (${c.managerTitle})\nLocation: ${c.location}\nPhone: ${c.phone}\nEmail: ${c.email}\nActivities: ${c.activities}\nCategory: ${c.category}\nStatus: ${c.status}\nMembership: ${c.membershipDate} - ${c.endDate}\nSource: ${c.sourceUrl}`
  );
}

function copy(text) {
  navigator.clipboard.writeText(text);
  showToast(t('copiedToast'));
}

$('#closeDetail').onclick = () => dialog.close();
$('#search').oninput = applyFilters;
$('#categoryFilter').onchange = applyFilters;
$('#statusFilter').onchange = applyFilters;
$('#sortBy').onchange = applyFilters;

$('#copyAll').onclick = () => copy(
  currentItems.map((c) => `${c.companyName} | ${c.activities} | ${c.manager} | ${c.location} | ${c.phone}`).join('\n')
);

$('#export').onclick = () => {
  const headers = ['companyName', 'activities', 'manager', 'managerTitle', 'location', 'phone', 'email', 'membershipDate', 'endDate', 'category', 'status', 'sourceUrl', 'imageUrl'];
  const rows = [headers, ...currentItems.map((c) => headers.map((h) => c[h]))];
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'erbil-chamber-companies.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};

function setProgress(state) {
  const bar = $('#progressBar');
  if (!state || state.status !== 'running') {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  let text = '';
  let pct = 0;
  if (state.phase === 'list') {
    text = t('progressList')(state.page, state.collected);
    pct = state.page ? Math.min(40, (state.page / 14) * 40) : 5;
  } else if (state.phase === 'detail') {
    text = t('progressDetail')(state.detailIndex, state.detailTotal);
    pct = state.detailTotal ? 40 + (state.detailIndex / state.detailTotal) * 60 : 40;
  }
  $('#progressFill').style.width = `${pct}%`;
  $('#progressText').textContent = text;
}

async function pollStatus() {
  try {
    const res = await fetch('/api/scrape-status');
    const state = await res.json();
    setProgress(state);
    if (state.status === 'running') {
      pollTimer = setTimeout(pollStatus, 800);
    } else {
      $('#progressBar').hidden = true;
    }
  } catch (e) {
    $('#progressBar').hidden = true;
  }
}

let lastData = null;

function setUpdatedAt(data) {
  lastData = data;
  const el = $('#updatedAt');
  if (!data.scrapedAt) { el.textContent = ''; return; }
  const d = new Date(data.scrapedAt);
  const src = t('src')[data.source] || data.source || t('src').live;
  el.textContent = `${t('updatedPrefix')}: ${d.toLocaleString('en-GB')} (${src})`;
}

let backendAvailable = true;

async function loadCompanies(refresh = false) {
  if (refresh && backendAvailable) {
    clearTimeout(pollTimer);
    pollStatus();
  }

  let data;
  try {
    if (!backendAvailable) throw new Error('backend unavailable');
    const res = await fetch(`/api/companies${refresh ? '?refresh=1' : ''}`);
    if (!res.ok) throw new Error(`api status ${res.status}`);
    data = await res.json();
  } catch (e) {
    // No backend here (e.g. static hosting like Netlify with no Node server) —
    // fall back to the last scraped snapshot shipped alongside the app.
    backendAvailable = false;
    clearTimeout(pollTimer);
    $('#progressBar').hidden = true;
    const res = await fetch('companies-cache.json');
    data = await res.json();
    data.source = 'static-file';
    if (refresh) showToast(t('noBackendToast'));
  }

  companies = data.companies || [];
  setUpdatedAt(data);
  populateFilters();
  applyFilters();

  if (data.pagesScraped) {
    const expected = data.expectedFromPages;
    console.log(`Scraped ${data.pagesScraped} list pages, expected ~${expected} rows, collected ${companies.length} unique companies.`);
  }
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

$('#refresh').onclick = async () => {
  $('#refresh').disabled = true;
  try {
    await loadCompanies(true);
  } finally {
    $('#refresh').disabled = false;
  }
};

function applyStaticTranslations() {
  $('#brandTitle').textContent = t('brandTitle');
  $('#brandSub').textContent = t('brandSub');
  $('#officialLink').textContent = t('officialLink');
  $('#heroTitle').textContent = t('heroTitle');
  $('#heroSub').textContent = t('heroSub');
  $('#search').placeholder = t('searchPlaceholder');
  $('#refreshLabel').textContent = t('refresh');
  $('#copyAllLabel').textContent = t('copyAll');
  $('#exportLabel').textContent = t('exportBtn');
  // #allCategoriesOpt / #allStatusesOpt are regenerated by populateFilters()
  // (which loses the id), so their "all" text is translated there instead.
  $('#sortNameOpt').textContent = t('sortName');
  $('#sortMembershipOpt').textContent = t('sortMembership');
  $('#closeDetail').setAttribute('aria-label', t('closeLabel'));
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
}

function setLang(next) {
  lang = next;
  try { localStorage.setItem('ecc_lang', lang); } catch (e) { /* private mode etc. */ }
  applyStaticTranslations();
  populateFilters();
  if (companies.length) applyFilters();
  if (lastData) setUpdatedAt(lastData);
  if (dialog.open) dialog.close();
}

document.querySelectorAll('.lang-btn').forEach((b) => {
  b.onclick = () => setLang(b.dataset.lang);
});

applyStaticTranslations();
loadCompanies(false);
