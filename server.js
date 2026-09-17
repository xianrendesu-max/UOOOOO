const express = require('express');
const cheerio = require('cheerio');
const app = express();
const PORT = 3000;

const BASE_URL = 'https://xvideo-jp.com';

app.use(express.static('public'));

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { time: Date.now(), value });
}

app.get('/api/video-info', async (req, res) => {
  const id = String(req.query.id || '').trim();

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const cacheKey = `video:${id}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const url = `${BASE_URL}/sad/${id}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.8',
      },
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `upstream error: ${response.status}` });
    }

    const html = await response.text();

    const m3u8Match = html.match(/data-m3u8="([^"]+)"/);
    const mp4Match = html.match(/data-mp4="([^"]+)"/);
    const imgMatch = html.match(/data-img="([^"]+)"/);
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);

    const result = {
      id,
      title: titleMatch ? titleMatch[1].trim() : null,
      m3u8: m3u8Match ? m3u8Match[1] : null,
      mp4: mp4Match ? mp4Match[1] : null,
      poster: imgMatch ? imgMatch[1] : null,
      pageUrl: url,
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[video-info] error:', err);
    res.status(500).json({ error: 'fetch failed' });
  }
});

// ───────────────────────────────────────────
// 検索API
//   GET /api/search?q=キーワード&page=1
// ───────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  if (!keyword) {
    return res.json({ keyword: '', page, results: [] });
  }

  const cacheKey = `search:${keyword}:${page}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  let url = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;
  if (page > 1) {
    url += `&paged=${page}`;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.8',
      },
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `upstream error: ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];


    $('.article_card-summar').each((i, el) => {
      const $el = $(el);

      const $link = $el.find('a.js-atd__link').first();
      const href = $link.attr('href') || '';
      const title = $link.text().replace(/\s+/g, ' ').trim();

      const idMatch = href.match(/\/sad\/(\d+)/);
      const id = idMatch ? idMatch[1] : null;
      if (!id) return;


      const likes = $el
        .find('button.js-atd__button span')
        .first()
        .text()
        .trim();

      const ago = $el.find('.article__ago').first().text().trim();

      results.push({
        id,
        title,
        href: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        likes: likes || '0',
        ago: ago || '',
      });
    });

    let hasNext = false;
    const nextLink = $('a.next.page-numbers').attr('href');
    if (nextLink) hasNext = true;

    const result = { keyword, page, hasNext, results };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[search] error:', err);
    res.status(500).json({ error: 'fetch failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
