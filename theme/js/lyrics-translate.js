/*
 * Gatefold · lyrics-translate.js — optional Japanese → English via DeepL API.
 */
import * as IDB from './idb.js';
import { httpPost, ok } from './bridge.js';

const URL_KEY = 'aurora.lyrics.translate.url';
const KEY_KEY = 'aurora.lyrics.translate.key';
const DEFAULT_URL = 'https://api-free.deepl.com/v2';
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;

const hashLines = (lines) => {
  const s = JSON.stringify(lines);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

function endpoint() {
  try { return (localStorage.getItem(URL_KEY) || DEFAULT_URL).replace(/\/+$/, ''); }
  catch { return DEFAULT_URL; }
}

function authKey() {
  try { return localStorage.getItem(KEY_KEY) || ''; }
  catch { return ''; }
}

function configAPI() {
  let current = endpoint();
  const value = window.prompt('DeepL API URL', current);
  if (value == null) return '';
  const url = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    window.alert('Enter a URL starting with http:// or https://');
    return '';
  }
  const key = window.prompt('DeepL Auth Key', authKey());
  if (key == null) return '';
  const cleanKey = key.trim();
  if (!cleanKey) {
    window.alert('Enter your DeepL API key.');
    return '';
  }
  try {
    localStorage.setItem(URL_KEY, url);
    localStorage.setItem(KEY_KEY, cleanKey);
  } catch {}
  return url;
}

async function translateBatch(texts, url, key) {
  const response = await httpPost({
    url: url + '/translate',
    body: JSON.stringify({ text: texts, source_lang: 'JA', target_lang: 'EN' }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `DeepL-Auth-Key ${key}`,
    },
    timeout: 30000,
  });
  if (!ok(response) || (response.status && response.status >= 400)) {
    throw new Error(response.error || `HTTP ${response.status || 'error'}`);
  }
  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  if (!data || !Array.isArray(data.translations) || !data.translations.length) {
    throw new Error('DeepL returned no translated text');
  }
  return data.translations.map((item) => item.text || '');
}

async function translateLyrics(view, button) {
  if (button.dataset.busy === '1') return;
  const rows = [...view.querySelectorAll('.ln[data-i]')];
  const originals = rows.map((row) => {
    const original = row.querySelector('.lyr-original');
    return (original ? original.textContent : [...row.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('lyr-translation'))).map((n) => n.textContent).join('')).trim();
  });
  const work = rows.map((row, i) => ({ row, text: originals[i] })).filter((x) => x.text && JAPANESE.test(x.text) && !x.row.querySelector('.lyr-translation'));
  if (!work.length) return;

  let url = endpoint();
  let key = authKey();
  if (!url || !/^https?:\/\//i.test(url)) {
    url = configAPI();
  }
  key = authKey();
  if (!url || !key) return;

  button.dataset.busy = '1';
  button.disabled = true;
  const oldLabel = button.textContent;
  button.textContent = 'Translating…';

  try {
    const keyId = 'lyrtr:ja-en:' + hashLines(originals);
    let translations = await IDB.kvGet(keyId);
    if (!Array.isArray(translations) || translations.length !== originals.length) {
      translations = Array(originals.length).fill('');
      const indexes = originals.map((text, i) => text && JAPANESE.test(text) ? i : -1).filter((i) => i >= 0);
      for (let start = 0; start < indexes.length; start += 8) {
        const batch = indexes.slice(start, start + 8);
        const translated = await translateBatch(batch.map((i) => originals[i]), url, key);
        batch.forEach((i, j) => { translations[i] = translated[j] || ''; });
      }
      await IDB.kvSet(keyId, translations);
    }

    rows.forEach((row, i) => {
      const text = translations[i];
      if (!text || !JAPANESE.test(originals[i]) || row.querySelector('.lyr-translation')) return;
      const el = document.createElement('div');
      el.className = 'lyr-translation';
      el.textContent = text;
      row.append(el);
    });
  } catch (e) {
    console.warn('[Gatefold] lyrics translation failed', e);
    window.alert(`Translation failed. Check that your DeepL API key is valid and the API URL is correct.\n${e.message || e}`);
  } finally {
    button.dataset.busy = '0';
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function addButton(view) {
  if (view.querySelector('.lyr-translate')) return;
  const button = document.createElement('button');
  button.className = 'lyr-translate btn sm';
  button.type = 'button';
  button.textContent = 'Translate';
  button.title = 'Translate Japanese lyrics to English using DeepL';
  button.addEventListener('click', () => translateLyrics(view, button));
  if (view.classList.contains('lyr-canvas')) view.append(button);
  else {
    const bar = view.closest('.np-panel')?.querySelector('.lyr-bar');
    if (bar) bar.append(button);
  }
}

function scan(root = document) {
  root.querySelectorAll?.('.lyr').forEach(addButton);
}

if (document.body) {
  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
}

const style = document.createElement('style');
style.textContent = `
.lyr-translation { margin-top: 3px; color: var(--text-2); opacity: .84; font: 450 .78em/1.35 var(--font-ui); letter-spacing: 0; transform: none !important; text-shadow: none !important; }
.lyr-translate { z-index: 2; }
.lyr-canvas .lyr-translate { position: absolute; top: 0; right: 6px; height: 26px; padding: 0 9px; font-size: var(--fs-xs); }
.cv .lyr-canvas { padding-top: 30px; }
`;
document.head.append(style);
