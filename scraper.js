const cheerio = require('cheerio');

const BASE = 'https://www.erbilchamber.org';
const LIST_URL = `${BASE}/companies.aspx`;
const PER_PAGE = 24;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function extractCookies(res, jar) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchHtml(url, jar) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) } });
  extractCookies(res, jar);
  return await res.text();
}

// Parses the ASP.NET AJAX (MS AJAX) partial-postback "delta" response format:
// repeated blocks of `<byteLength>|<type>|<id>|<content>|`
function parseDelta(s) {
  const items = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('|', i);
    if (j < 0) break;
    const len = parseInt(s.slice(i, j), 10);
    if (Number.isNaN(len)) break;
    i = j + 1;
    const j2 = s.indexOf('|', i);
    const type = s.slice(i, j2);
    i = j2 + 1;
    const j3 = s.indexOf('|', i);
    const id = s.slice(i, j3);
    i = j3 + 1;
    const content = s.slice(i, i + len);
    i += len;
    if (s[i] === '|') i++;
    items.push({ type, id, content });
  }
  return items;
}

function formFields($) {
  const form = $('form').first();
  const fields = {};
  form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const type = ($(el).attr('type') || '').toLowerCase();
    // Exclude submit/button/image inputs: including their name/value in the
    // POST body makes ASP.NET treat that button as clicked (e.g. resets to page 1).
    if (type === 'submit' || type === 'button' || type === 'image') return;
    if (type === 'checkbox' || type === 'radio') {
      if ($(el).is(':checked')) fields[name] = $(el).attr('value') || 'on';
    } else {
      fields[name] = $(el).attr('value') || '';
    }
  });
  return fields;
}

async function postBack(fields, eventTarget, jar) {
  const body = {
    ...fields,
    'ctl00$ScriptManager1': `ctl00$ContentPlaceHolder1$UpdatePanel2|${eventTarget}`,
    __EVENTTARGET: eventTarget,
    __EVENTARGUMENT: '',
    __ASYNCPOST: 'true',
  };
  const res = await fetch(LIST_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
      'X-MicrosoftAjax': 'Delta=true',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams(body).toString(),
  });
  extractCookies(res, jar);
  const text = await res.text();
  const items = parseDelta(text);

  const panel = items.find((it) => it.type === 'updatePanel' && it.id === 'ContentPlaceHolder1_UpdatePanel2');
  const updatedFields = { ...fields };
  for (const it of items) {
    if (it.type === 'hiddenField') updatedFields[it.id] = it.content;
  }
  return { panelHtml: panel ? panel.content : '', fields: updatedFields };
}

function parseListRows($) {
  const rows = [];
  $('.icon-content').each((_, el) => {
    const href = $(el).find('a.site-button').attr('href') || '';
    const m = href.match(/id=(\d+)/);
    if (!m) return; // skip non-company icon-content blocks (e.g. footer)
    const name = $(el).find('h5.dlab-tilte').text().trim();
    const activity = $(el).find('p').first().text().trim();
    if (!name) return;
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
  let fields = formFields($);

  const all = new Map();
  let pageNum = 1;

  while (true) {
    const rows = parseListRows($);
    for (const r of rows) all.set(r.id, r);

    const { currentPage, links } = parsePager($);
    if (onProgress) onProgress({ page: currentPage, collected: all.size });

    const nextNumeric = links.find((l) => l.text === String(currentPage + 1) && !l.isNext);
    const nextJump = links.find((l) => l.isNext);
    const target = nextNumeric ? nextNumeric.target : nextJump ? nextJump.target : null;
    if (!target) break;

    const { panelHtml, fields: updatedFields } = await postBack(fields, target, jar);
    fields = updatedFields;
    $ = cheerio.load(panelHtml);
    pageNum++;
    if (pageNum > 2000) break; // safety guard
  }

  return { companies: Array.from(all.values()), pagesScraped: pageNum };
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
  const imgSrc = $('.company-image img').attr('src') || '';
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
    imageUrl: imgSrc.trim() || '—',
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
