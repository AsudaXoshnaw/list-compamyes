const cheerio = require('cheerio');

const BASE = 'https://www.erbilchamber.org';
const LIST_URL = `${BASE}/companies.aspx`;
const PER_PAGE = 24;

function extractCookies(res, jar) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const [name, value] = pair.split('=');
    jar[name.trim()] = value;
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchHtml(url, jar) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Cookie: cookieHeader(jar),
    },
  });
  extractCookies(res, jar);
  return await res.text();
}

async function postForm($, body, jar) {
  const form = $('form').first();
  const inputs = {};
  form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const type = ($(el).attr('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      if ($(el).is(':checked')) inputs[name] = $(el).attr('value') || 'on';
    } else {
      inputs[name] = $(el).attr('value') || '';
    }
  });
  form.find('select').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    inputs[name] = $(el).find('option[selected]').attr('value') || $(el).find('option').first().attr('value') || '';
  });
  Object.assign(inputs, body);

  const params = new URLSearchParams(inputs);
  const res = await fetch(LIST_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body: params.toString(),
  });
  extractCookies(res, jar);
  return await res.text();
}

function parseListRows($) {
  const rows = [];
  $('.icon-content').each((_, el) => {
    const name = $(el).find('h5.dlab-tilte').text().trim();
    const activity = $(el).find('p').first().text().trim();
    const href = $(el).find('a.site-button').attr('href') || '';
    const m = href.match(/id=(\d+)/);
    if (!name || !m) return;
    rows.push({ id: m[1], name, activity });
  });
  return rows;
}

function parsePager($) {
  const pagerSpan = $('#ContentPlaceHolder1_PeopleDataPager');
  const currentPage = parseInt(pagerSpan.find('.currentpage').text().trim(), 10) || 1;
  const links = [];
  pagerSpan.find('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    const cls = $(el).attr('class') || '';
    const m = href.match(/__doPostBack\('([^']+)'/);
    if (m) links.push({ target: m[1], text, isNext: cls.includes('nextbutton') });
  });
  return { currentPage, links };
}

async function scrapeAllListPages(onProgress) {
  const jar = {};
  let html = await fetchHtml(LIST_URL, jar);
  let $ = cheerio.load(html);

  const all = new Map();
  let pageNum = 1;
  let estimatedTotalPages = null;

  while (true) {
    const rows = parseListRows($);
    for (const r of rows) all.set(r.id, r);

    const { currentPage, links } = parsePager($);
    estimatedTotalPages = estimatedTotalPages || null;
    if (onProgress) onProgress({ page: currentPage, totalKnown: estimatedTotalPages, collected: all.size });

    const nextNumeric = links.find(l => l.text === String(currentPage + 1) && !l.isNext);
    const nextJump = links.find(l => l.isNext);

    let target = null;
    if (nextNumeric) target = nextNumeric.target;
    else if (nextJump) target = nextJump.target;

    if (!target) break;

    html = await postForm($, { __EVENTTARGET: target, __EVENTARGUMENT: '' }, jar);
    $ = cheerio.load(html);
    pageNum++;
    if (pageNum > 2000) break; // safety guard against infinite loop
  }

  return { companies: Array.from(all.values()), pagesScraped: pageNum };
}

function textOrDash($el) {
  const t = $el.text().replace(/\s+/g, ' ').trim();
  return t || '—';
}

function fieldValue($, label) {
  let val = '';
  $('.info-row').each((_, el) => {
    const lab = $(el).find('.info-label').text().trim();
    if (lab.toLowerCase() === label.toLowerCase()) {
      val = $(el).find('.info-value').text().replace(/\s+/g, ' ').trim();
    }
  });
  return val || '—';
}

async function scrapeDetail(id, jar) {
  const url = `${BASE}/companiesDetail.aspx?id=${id}`;
  const html = await fetchHtml(url, jar);
  const $ = cheerio.load(html);

  const companyName = $('.company-title').first().text().trim() || '—';
  const managerTitle = $('.badge-position').first().text().trim() || '—';
  const status = $('.status-pill .status-pill').first().text().trim() || $('.status-pill').first().text().trim() || '—';
  const imageUrl = $('.company-image img').attr('src') || '';
  const activities = [];
  $('.company-activities li').each((_, el) => {
    const t = $(el).text().trim();
    if (t) activities.push(t);
  });

  return {
    id,
    companyName,
    activities: activities.length ? activities.join(', ') : '—',
    manager: fieldValue($, 'Manager'),
    managerTitle,
    location: fieldValue($, 'Location'),
    phone: fieldValue($, 'Phone'),
    email: fieldValue($, 'Email'),
    membershipDate: fieldValue($, 'Membership'),
    endDate: fieldValue($, 'End Date'),
    category: fieldValue($, 'Category'),
    status,
    sourceUrl: url,
    imageUrl: imageUrl || '—',
  };
}

async function scrapeAll(onProgress) {
  const { companies: listCompanies, pagesScraped } = await scrapeAllListPages(
    (p) => onProgress && onProgress({ phase: 'list', ...p })
  );

  const results = [];
  const jar = {};
  for (let i = 0; i < listCompanies.length; i++) {
    const c = listCompanies[i];
    try {
      const detail = await scrapeDetail(c.id, jar);
      results.push(detail);
    } catch (e) {
      results.push({
        id: c.id,
        companyName: c.name || '—',
        activities: c.activity || '—',
        manager: '—', managerTitle: '—', location: '—', phone: '—', email: '—',
        membershipDate: '—', endDate: '—', category: '—', status: '—',
        sourceUrl: `${BASE}/companiesDetail.aspx?id=${c.id}`, imageUrl: '—',
      });
    }
    if (onProgress) onProgress({ phase: 'detail', index: i + 1, total: listCompanies.length });
  }

  // de-duplicate by id
  const dedup = new Map();
  for (const r of results) dedup.set(r.id, r);

  return {
    companies: Array.from(dedup.values()),
    pagesScraped,
    listCount: listCompanies.length,
    expectedFromPages: pagesScraped * PER_PAGE,
  };
}

module.exports = { scrapeAll, scrapeAllListPages, scrapeDetail };
