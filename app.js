const $ = (s) => document.querySelector(s);
const grid = $('#grid'), dialog = $('#detail');
const PAGE_SIZE = 12;

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
  catSel.innerHTML = '<option value="">هەموو پۆلەکان</option>' +
    [...categories].sort().map((c) => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
  statSel.innerHTML = '<option value="">هەموو دۆخەکان</option>' +
    [...statuses].sort().map((c) => `<option value="${escapeAttr(c)}">${c}</option>`).join('');
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

  $('#count').textContent = `${items.length} کۆمپانیا پیشان دەدرێت`;

  grid.innerHTML = shown.map((c) => `
    <article class="card">
      <span class="badge">${dash(c.status)}</span>
      <div class="globe">◎</div>
      <h2>${c.companyName}</h2>
      <p>${dash(c.activities)}</p>
      <button class="more" data-id="${c.id}">زیاتر</button>
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
        <div class="field"><b>MANAGER</b><span>${dash(c.manager)}</span></div>
        <div class="field"><b>TITLE</b><span>${dash(c.managerTitle)}</span></div>
        <div class="field"><b>LOCATION</b><span>${dash(c.location)}</span></div>
        <div class="field"><b>PHONE</b><span>${dash(c.phone)}</span></div>
        <div class="field"><b>EMAIL</b><span>${dash(c.email)}</span></div>
        <div class="field"><b>MEMBERSHIP</b><span>${dash(c.membershipDate)}</span></div>
        <div class="field"><b>END DATE</b><span>${dash(c.endDate)}</span></div>
        <div class="field"><b>CATEGORY</b><span>${dash(c.category)}</span></div>
      </div>
      <section class="activities">
        <h3>ACTIVITIES</h3>
        <div class="chips">${dash(c.activities).split(',').map((x) => `<span class="chip">${x.trim()}</span>`).join('')}</div>
      </section>
      <div class="detail-actions">
        <button class="map" id="map">⌖ کردنەوە لە Maps</button>
        <button class="copy" id="copyPhone">☎ کۆپی‌کردنی ژمارە</button>
        <button class="copy" id="copyInfo">⧉ کۆپی هەموو زانیاری</button>
        <a class="copy" target="_blank" href="${c.sourceUrl}">سەرچاوەی فەرمی ↗</a>
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
  const t = $('#toast');
  t.textContent = 'زانیارییەکان کۆپی کران';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

$('.close').onclick = () => dialog.close();
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
    text = `پەیجی ${state.page ?? '?'} ... ${state.collected} کۆمپانیا خوێندرایەوە`;
    pct = state.page ? Math.min(40, (state.page / 14) * 40) : 5;
  } else if (state.phase === 'detail') {
    text = `وردەکاری کۆمپانیا ${state.detailIndex} لە ${state.detailTotal}`;
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

function setUpdatedAt(data) {
  const el = $('#updatedAt');
  if (!data.scrapedAt) { el.textContent = ''; return; }
  const d = new Date(data.scrapedAt);
  const src = data.source === 'cache' ? 'cache' : data.source === 'cache-fallback' ? 'cache (fallback)' : 'live';
  el.textContent = `نوێکراوەتەوە: ${d.toLocaleString('en-GB')} (${src})`;
}

async function loadCompanies(refresh = false) {
  if (refresh) {
    clearTimeout(pollTimer);
    pollStatus();
  }
  const res = await fetch(`/api/companies${refresh ? '?refresh=1' : ''}`);
  const data = await res.json();
  companies = data.companies || [];
  setUpdatedAt(data);
  populateFilters();
  applyFilters();

  if (data.pagesScraped) {
    const expected = data.expectedFromPages;
    console.log(`Scraped ${data.pagesScraped} list pages, expected ~${expected} rows, collected ${companies.length} unique companies.`);
  }
}

$('#refresh').onclick = async () => {
  $('#refresh').disabled = true;
  try {
    await loadCompanies(true);
  } finally {
    $('#refresh').disabled = false;
  }
};

loadCompanies(false);
