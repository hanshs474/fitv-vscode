// Free Image to Video HTTP client (https://freeimagetovideo.ai). Plain node 20, no dependencies.
'use strict';

const BASE = 'https://freeimagetovideo.ai';
const KEYS_URL = `${BASE}/settings/apikeys`;
const PRICING_URL = `${BASE}/pricing`;
const DEFAULT_MODEL = 'minimax-h3';
const UA = 'fitv-vscode/0.1.0';

/**
 * kind: auth | quota | plan | busy | rejected | generation | timeout | validation | api
 * auth: no or bad key · quota: not enough credits · plan: API runs need a paid plan ·
 * busy: too many runs at once · rejected: content filter or cooldown ·
 * generation: accepted but failed or canceled · timeout: still generating
 */
class FreeImageToVideoError extends Error {
  constructor(message, kind = 'api', extra = {}) {
    super(message);
    this.name = 'FreeImageToVideoError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** Map an HTTP status and envelope to the error that says what to do next (same rules as the Go SDK). */
function classify(status, body) {
  body = body || {};
  const message = body.message || `request failed (HTTP ${status})`;
  const code = typeof body.code === 'number' ? body.code : 0;
  const reason = body.data && typeof body.data.reason === 'string' ? body.data.reason : undefined;
  const kind = status === 401 ? 'auth'
    : code === -2 || code === -3 ? 'rejected'
    : reason === 'insufficient_credits' ? 'quota'
    : reason === 'plan_required' ? 'plan'
    : reason === 'concurrency' ? 'busy'
    : /no auth/i.test(message) ? 'auth'
    : 'api';
  let text = message;
  if (kind === 'quota' && !/\/pricing/.test(text)) text += `; see ${PRICING_URL}`;
  if (kind === 'plan' && !/\/pricing/.test(text)) text += `; API runs need a paid plan: ${PRICING_URL}`;
  if (kind === 'auth' && !/settings\/apikeys/.test(text)) text += `; create a key at ${KEYS_URL}`;
  return new FreeImageToVideoError(text, kind, { status, code, reason });
}

/**
 * Read one answer. Success = HTTP < 400 and code === 0; the API answers most refusals as
 * HTTP 200 with a non-zero code, so the status code alone reads a refusal as success.
 */
function parseEnvelope(status, body) {
  if (status < 400 && body && body.code === 0) return body.data || {};
  if (!body || typeof body !== 'object') {
    if (status === 401) throw classify(401, {});
    throw new FreeImageToVideoError(`freeimagetovideo.ai returned a non-JSON response (HTTP ${status})`, 'api', { status, transient: true });
  }
  throw classify(status, body);
}

/** The request body for POST /api/ai/generate. */
function generateBody(prompt, { model, imageUrl, options } = {}) {
  const opts = {};
  for (const [k, v] of Object.entries(options || {})) if (v !== undefined && v !== null && v !== '') opts[k] = v;
  opts.sound = true;
  let scene = 'text-to-video';
  if (imageUrl) {
    opts.image_input = [imageUrl];
    scene = 'image-to-video';
  }
  // The server routes by model; provider only has to be non-empty.
  return { provider: 'auto', mediaType: 'video', model: model || DEFAULT_MODEL, scene, prompt, options: opts };
}

class FreeImageToVideo {
  constructor({ apiKey = process.env.FREEIMAGETOVIDEO_API_KEY, baseUrl = process.env.FREEIMAGETOVIDEO_BASE_URL || BASE, fetch: f = globalThis.fetch, userAgent = UA } = {}) {
    this.key = String(apiKey || '').trim();
    this.base = String(baseUrl).replace(/\/+$/, '');
    this.fetch = f;
    this.ua = userAgent;
  }

  async post(path, payload) {
    if (!this.key) throw new FreeImageToVideoError(`an API key is required; create one at ${KEYS_URL}`, 'auth');
    let res;
    try {
      res = await this.fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}`, 'user-agent': this.ua },
        body: JSON.stringify(payload || {}),
      });
    } catch (e) {
      throw new FreeImageToVideoError(`could not reach freeimagetovideo.ai: ${e.message || e}`, 'api', { transient: true });
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    return parseEnvelope(res.status, body);
  }

  /**
   * Put a local photo on freeimagetovideo.ai's storage and return its public https URL, for image to video.
   * bytes: Uint8Array / Buffer; mime: image/jpeg | image/png | image/webp (the Blob must carry it).
   */
  async uploadImage(bytes, mime, filename = 'photo') {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: mime }), filename);
    let res;
    try {
      res = await this.fetch(`${this.base}/api/storage/upload-image`, { method: 'POST', headers: { 'user-agent': this.ua }, body: form });
    } catch (e) {
      throw new FreeImageToVideoError(`could not reach freeimagetovideo.ai: ${e.message || e}`, 'api', { transient: true });
    }
    if (res.status === 413) throw new FreeImageToVideoError('this photo is over 10MB; use a smaller one', 'validation', { status: 413 });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    const d = parseEnvelope(res.status, body);
    if (!Array.isArray(d.urls) || !d.urls[0]) throw new FreeImageToVideoError('the upload returned no URL');
    return d.urls[0];
  }

  /** Credits left on the account (free to call). */
  async credits() {
    const d = await this.post('/api/user/get-user-credits', {});
    return Number(d.remainingCredits || 0);
  }

  /** Start a run and return its task id without waiting. */
  async submit(prompt, opts = {}) {
    if (!String(prompt || '').trim()) throw new FreeImageToVideoError('prompt is required', 'validation');
    const d = await this.post('/api/ai/generate', generateBody(prompt, opts));
    if (d.id === undefined || d.id === null || d.id === '') throw new FreeImageToVideoError('freeimagetovideo.ai accepted the run but returned no id');
    return String(d.id);
  }

  /** Look up a run: {id, status, videos, errorMessage, failureKind, queued, queueEta}. */
  async status(id) { return this.post('/api/ai/query', { taskId: id }); }

  /** Poll a run every pollMs until it finishes; resolve to the video URL. Queued runs report pending/processing; keep waiting. */
  async wait(id, { timeoutMs = 30 * 60_000, pollMs = 10_000, onStatus } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let d = null;
      try { d = await this.status(id); } catch (e) {
        if (!e.transient) throw e; // a dropped poll is not a failed run; a refusal is final
      }
      if (d) {
        if (onStatus) onStatus(d);
        if (d.status === 'success') {
          if (Array.isArray(d.videos) && d.videos[0]) return d.videos[0];
          throw new FreeImageToVideoError(`run ${id} finished with no video`, 'generation', { taskId: id });
        }
        if (d.status === 'failed' || d.status === 'canceled') {
          throw new FreeImageToVideoError(`run ${id} ${d.status}: ${d.errorMessage || d.status}`, 'generation',
            { taskId: id, failureKind: d.failureKind || undefined });
        }
      }
      if (Date.now() + pollMs >= deadline) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new FreeImageToVideoError(`run ${id} is still generating; it will land in your Free Image to Video history`, 'timeout', { taskId: id });
  }

  /** Submit, wait, return the URL of the finished MP4 (with sound). */
  async generateVideo(prompt, opts = {}) {
    return this.wait(await this.submit(prompt, opts), opts);
  }
}

module.exports = { FreeImageToVideo, FreeImageToVideoError, classify, parseEnvelope, generateBody, BASE, KEYS_URL, PRICING_URL, DEFAULT_MODEL };
