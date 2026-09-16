const express = require('express');
const fs = require('fs');
const path = require('path');
const { scrapeAll } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'companies-cache.json');
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

let state = {
  status: 'idle', // idle | running | done | error
  phase: null,
  page: null,
  detailIndex: null,
  detailTotal: null,
  collected: 0,
  pagesScraped: null,
  expectedFromPages: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

let cache = loadCache();
let scrapePromise = null;

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.companies)) return data;
  } catch (e) {
    // no cache yet
  }
  return null;
}

function saveCache(data) {
  cache = data;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function runScrape() {
  if (scrapePromise) return scrapePromise;

  state = {
    status: 'running',
    phase: 'list',
    page: null,
    detailIndex: null,
    detailTotal: null,
    collected: 0,
    pagesScraped: null,
    expectedFromPages: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  scrapePromise = scrapeAll((p) => {
    if (p.phase === 'list') {
      state.phase = 'list';
      state.page = p.page;
      state.collected = p.collected;
    } else if (p.phase === 'detail') {
      state.phase = 'detail';
      state.detailIndex = p.index;
      state.detailTotal = p.total;
    }
  })
    .then((result) => {
      const data = {
        companies: result.companies,
        pagesScraped: result.pagesScraped,
        listCount: result.listCount,
        expectedFromPages: result.expectedFromPages,
        scrapedAt: new Date().toISOString(),
      };
      saveCache(data);
      state.status = 'done';
      state.pagesScraped = result.pagesScraped;
      state.expectedFromPages = result.expectedFromPages;
      state.collected = result.companies.length;
      state.finishedAt = new Date().toISOString();
      return data;
    })
    .catch((err) => {
      state.status = 'error';
      state.error = String(err && err.message ? err.message : err);
      state.finishedAt = new Date().toISOString();
      throw err;
    })
    .finally(() => {
      scrapePromise = null;
    });

  return scrapePromise;
}

app.use(express.static(__dirname));

// Returns cached companies immediately if fresh; otherwise scrapes live.
// ?refresh=1 forces a fresh scrape regardless of cache age.
app.get('/api/companies', async (req, res) => {
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const isFresh = cache && Date.now() - new Date(cache.scrapedAt).getTime() < CACHE_MAX_AGE_MS;

  if (!forceRefresh && isFresh) {
    return res.json({ ...cache, source: 'cache' });
  }

  try {
    const data = await runScrape();
    res.json({ ...data, source: 'live' });
  } catch (err) {
    if (cache) {
      res.status(200).json({ ...cache, source: 'cache-fallback', error: String(err) });
    } else {
      res.status(502).json({ error: String(err) });
    }
  }
});

app.get('/api/scrape-status', (req, res) => {
  res.json(state);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
