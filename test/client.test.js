'use strict';
// Offline tests against answers shaped like the live API; `node test/client.test.js --live` adds the free wrong-key check.
const assert = require('assert');
const { FreeImageToVideo } = require('../client');

function fake(steps, calls) {
  let polls = 0;
  return async (url, init) => {
    calls.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, auth: init.headers.authorization });
    if (url.endsWith('/api/ai/generate')) return { status: 200, json: async () => ({ code: 0, data: { id: 't1', status: 'pending' } }) };
    if (url.endsWith('/api/storage/upload-image')) return { status: 200, json: async () => ({ code: 0, data: { urls: ['https://cdn.freeimagetovideo.ai/input/a.jpg'] } }) };
    const d = steps[Math.min(polls++, steps.length - 1)];
    return { status: 200, json: async () => d };
  };
}

(async () => {
  const calls = [];
  const c = new FreeImageToVideo({ apiKey: 'sk-x', fetch: fake([
    { code: 0, data: { id: 't1', status: 'processing', queued: true, queueEta: 5 } },
    { code: 0, data: { id: 't1', status: 'success', videos: ['https://cdn/x.mp4'] } },
  ], calls) });
  const img = await c.uploadImage(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', 'a.jpg');
  assert.strictEqual(img, 'https://cdn.freeimagetovideo.ai/input/a.jpg');
  const file = calls[0].body.get('files');
  assert.strictEqual(file.type, 'image/jpeg');
  assert.strictEqual(await c.generateVideo('the camera pushes in', { imageUrl: img, options: { duration: 6 }, pollMs: 0 }), 'https://cdn/x.mp4');
  assert.deepStrictEqual(calls[1].body, { provider: 'auto', mediaType: 'video', model: 'minimax-h3', scene: 'image-to-video', prompt: 'the camera pushes in',
    options: { duration: 6, sound: true, image_input: [img] } });
  assert.deepStrictEqual(calls[2].body, { taskId: 't1' });
  assert.strictEqual(calls[1].auth, 'Bearer sk-x');

  const refuse = (status, body) => new FreeImageToVideo({ apiKey: 'sk-x', fetch: async () => ({ status, json: async () => body }) });
  const kind = (k) => (e) => e.kind === k;
  await assert.rejects(refuse(401, { code: -1, message: 'Invalid API key.', data: { reason: 'invalid_api_key' } }).credits(), kind('auth'));
  await assert.rejects(refuse(200, { code: -1, message: 'no auth, please sign in' }).submit('x'), kind('auth'));
  await assert.rejects(refuse(200, { code: -1, message: 'x', data: { reason: 'insufficient_credits' } }).submit('x'), kind('quota'));
  await assert.rejects(refuse(200, { code: -1, message: 'x', data: { reason: 'plan_required' } }).submit('x'), kind('plan'));
  await assert.rejects(refuse(200, { code: -1, message: 'x', data: { reason: 'concurrency' } }).submit('x'), kind('busy'));
  await assert.rejects(refuse(200, { code: -2, message: 'blocked' }).submit('x'), kind('rejected'));
  await assert.rejects(refuse(413, null).uploadImage(new Uint8Array(1), 'image/png'), kind('validation'));
  const failed = new FreeImageToVideo({ apiKey: 'sk-x', fetch: fake([{ code: 0, data: { status: 'failed', errorMessage: 'upstream error' } }], []) });
  await assert.rejects(failed.generateVideo('x', { pollMs: 0 }), (e) => e.kind === 'generation' && /upstream error/.test(e.message));
  assert.strictEqual(await refuse(200, { code: 0, data: { remainingCredits: 7 } }).credits(), 7);
  await assert.rejects(new FreeImageToVideo({ apiKey: '', fetch: async () => { throw new Error('should not call'); } }).credits(), kind('auth'));
  console.log('offline tests passed');

  if (process.argv.includes('--live')) {
    await assert.rejects(new FreeImageToVideo({ apiKey: 'sk-invalidtest000' }).submit('a paper lantern drifting over a night river'), (e) => e.kind === 'auth' && e.status === 401);
    console.log('live ok: wrong key -> generate -> auth');
  }
})().catch((e) => { console.error(e); process.exit(1); });
