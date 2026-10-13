import { config } from './config.js';

// Minimal fetch wrapper: redirects are never followed automatically, and an optional
// cookie jar (one per Session) emulates a browser well enough to drive an HTML login form.

export class Session {
  constructor() {
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  store(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const lower = attrs.map((a) => a.trim().toLowerCase());
      const expired =
        lower.includes('max-age=0') ||
        lower.some((a) => a.startsWith('expires=') && Date.parse(a.slice(8)) < Date.now());
      if (expired || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  // Returns { status, headers, text, json (parsed or undefined), location (absolute or undefined) }
  async request(url, { method = 'GET', headers = {}, form, json, body } = {}) {
    const h = { ...headers };
    const cookie = this.cookieHeader();
    if (cookie) h.cookie = cookie;
    let payload = body;
    if (form) {
      payload = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined)).toString();
      h['content-type'] ??= 'application/x-www-form-urlencoded';
    } else if (json) {
      payload = JSON.stringify(json);
      h['content-type'] ??= 'application/json';
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(config.httpTimeoutMs),
      });
    } catch (e) {
      throw new Error(
        `Network error calling ${method} ${url}: ${e.cause?.code ?? e.message}. ` +
          `Is the provider running and is ISSUER (${config.issuer}) correct?`,
      );
    }
    this.store(res);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const loc = res.headers.get('location');
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: parsed,
      location: loc ? new URL(loc, url).href : undefined,
    };
  }
}

const anon = new Session();
export const http = (url, opts) => anon.request(url, opts);
