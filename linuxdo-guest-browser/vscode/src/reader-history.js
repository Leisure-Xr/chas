'use strict';

const MAX_ENTRIES = 60;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const SITE_ORIGIN = 'https://linux.do';

function createHistoryEntry(action, title, explicitUrl, visitedAt = Date.now()) {
  const normalizedAction = normalizeAction(action);
  const url = normalizePublicUrl(explicitUrl || actionUrl(normalizedAction));
  const timestamp = Number(visitedAt);
  if (!normalizedAction || !url || !Number.isInteger(timestamp) || timestamp <= 0) return undefined;
  return { url, title: normalizeTitle(title || actionTitle(normalizedAction)), visitedAt: timestamp, action: normalizedAction };
}

function addHistoryEntry(current, candidate) {
  const result = [];
  if (candidate) result.push(candidate);
  for (const rawEntry of Array.isArray(current) ? current : []) {
    const entry = normalizeStoredEntry(rawEntry);
    if (!entry || candidate?.url === entry.url) continue;
    result.push(entry);
    if (result.length >= MAX_ENTRIES) break;
  }
  return result;
}

function normalizeStoredHistory(value) {
  const result = [];
  for (const rawEntry of Array.isArray(value) ? value : []) {
    const entry = normalizeStoredEntry(rawEntry);
    if (!entry || result.some((current) => current.url === entry.url)) continue;
    result.push(entry);
    if (result.length >= MAX_ENTRIES) break;
  }
  return result;
}

function normalizeStoredEntry(value) {
  if (!value || typeof value !== 'object') return undefined;
  return createHistoryEntry(value.action, value.title, value.url, Number(value.visitedAt));
}

function normalizeAction(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.type === 'topic') {
    const id = Number(value.id);
    const slug = String(value.slug || '').trim();
    if (!Number.isInteger(id) || id <= 0 || !/^[A-Za-z0-9_-]{1,200}$/.test(slug)) return undefined;
    return { type: 'topic', id, slug };
  }
  if (value.type === 'category') {
    const id = Number(value.id);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    return { type: 'category', id, name: normalizeTitle(value.name || '分类') };
  }
  if (value.type === 'search') {
    const query = String(value.query || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
    return query ? { type: 'search', query } : undefined;
  }
  const view = String(value.view || '');
  return value.type === 'view' && ['latest', 'top', 'categories'].includes(view)
    ? { type: 'view', view }
    : undefined;
}

function actionUrl(action) {
  if (!action) return '';
  if (action.type === 'topic') return `${SITE_ORIGIN}/t/${action.slug}/${action.id}`;
  if (action.type === 'category') return `${SITE_ORIGIN}/c/${action.id}`;
  if (action.type === 'search') return `${SITE_ORIGIN}/search?q=${encodeURIComponent(action.query)}`;
  if (action.view === 'top') return `${SITE_ORIGIN}/top`;
  if (action.view === 'categories') return `${SITE_ORIGIN}/categories`;
  return `${SITE_ORIGIN}/latest`;
}

function actionTitle(action) {
  if (!action) return '公开页面';
  if (action.type === 'category') return `${action.name} · 分类主题`;
  if (action.type === 'search') return `搜索：${action.query}`;
  if (action.type === 'topic') return 'LINUX DO 公开主题';
  if (action.view === 'top') return '本周热门';
  if (action.view === 'categories') return '浏览分类';
  return '最新主题';
}

function normalizeTitle(value) {
  const title = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\([0-9]+\)\s*/, '')
    .replace(/\s+-\s+(?:LINUX DO|搞七捻三)\s*$/i, '')
    .trim();
  return (title || '公开页面').slice(0, MAX_TITLE_LENGTH);
}

function normalizePublicUrl(value) {
  const input = String(value || '').trim();
  if (!input || input.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(input, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN || url.username || url.password) return undefined;
    if (/^\/(?:login|signup|session|auth)(?:\/|$)/i.test(url.pathname)) return undefined;
    if (/^\/cdn-cgi\//i.test(url.pathname) || [...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith('__cf_chl'))) {
      return undefined;
    }
    const topic = url.pathname.match(/^\/t\/(?:([^/]+)\/)?([1-9][0-9]*)(?:\/.*)?$/);
    if (topic) {
      url.pathname = `/t/${topic[1] || 'topic'}/${topic[2]}`;
      url.search = '';
    } else if (/^\/(?:latest|top|categories)\/?$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/$/, '');
      url.search = '';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

module.exports = {
  MAX_ENTRIES,
  actionTitle,
  actionUrl,
  addHistoryEntry,
  createHistoryEntry,
  normalizePublicUrl,
  normalizeStoredHistory
};
