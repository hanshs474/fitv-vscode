'use strict';
const vscode = require('vscode');
const path = require('path');
const { FreeImageToVideo, FreeImageToVideoError, BASE } = require('./client');

const SECRET = 'freeimagetovideo.apiKey';
const UTM = 'utm_source=vscode&utm_medium=extension';
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function apiKey(context) {
  return (await context.secrets.get(SECRET)) || process.env.FREEIMAGETOVIDEO_API_KEY || '';
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
}

function outputFolder() {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return undefined;
  const name = vscode.workspace.getConfiguration('freeimagetovideo').get('outputFolder') || 'assets';
  return vscode.Uri.joinPath(ws.uri, name);
}

function open(p) {
  vscode.env.openExternal(vscode.Uri.parse(`${BASE}${p}${p.includes('?') ? '&' : '?'}${UTM}`));
}

function reportError(err) {
  const kind = err instanceof FreeImageToVideoError ? err.kind : 'other';
  const actions = kind === 'auth' ? ['Set API Key', 'Get a Key'] : kind === 'quota' || kind === 'plan' ? ['See Plans'] : [];
  vscode.window.showErrorMessage(`Free Image to Video: ${err.message || err}`, ...actions).then((a) => {
    if (a === 'Set API Key') vscode.commands.executeCommand('freeimagetovideo.setApiKey');
    if (a === 'Get a Key') open('/settings/apikeys');
    if (a === 'See Plans') open('/pricing');
  });
}

function settings() {
  const c = vscode.workspace.getConfiguration('freeimagetovideo');
  const o = {};
  if (c.get('duration')) o.duration = Number(c.get('duration'));
  if (c.get('resolution')) o.resolution = c.get('resolution');
  if (c.get('aspectRatio')) o.aspect_ratio = c.get('aspectRatio');
  return o;
}

async function pickImage(uri) {
  if (uri && uri.fsPath && MIME[path.extname(uri.fsPath).toLowerCase()]) return { local: uri };
  const choice = await vscode.window.showQuickPick(
    [{ label: 'Pick a photo from disk', id: 'file' }, { label: 'Paste a public image URL', id: 'url' }],
    { title: 'Free Image to Video: Photo to Video' }
  );
  if (!choice) return null;
  if (choice.id === 'url') {
    const url = await vscode.window.showInputBox({ title: 'Image URL', prompt: 'A public https image (JPG, PNG or WebP)', placeHolder: 'https://example.com/photo.jpg',
      validateInput: (v) => (/^https:\/\/\S+$/.test(v.trim()) ? undefined : 'Must start with https://') });
    return url ? { url: url.trim() } : null;
  }
  const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['jpg', 'jpeg', 'png', 'webp'] }, openLabel: 'Animate this photo' });
  return files && files[0] ? { local: files[0] } : null;
}

async function makeClip(context, { withImage, uri }) {
  const key = await apiKey(context);
  if (!key) {
    return reportError(new FreeImageToVideoError(`Free Image to Video needs an API key. Create one at ${BASE}/settings/apikeys, then run "Free Image to Video: Set API Key".`, 'auth'));
  }
  let image = null;
  if (withImage) {
    image = await pickImage(uri);
    if (!image) return;
  }
  const prompt = await vscode.window.showInputBox({
    title: withImage ? 'Free Image to Video: Photo to Video' : 'Free Image to Video: Text to Video',
    prompt: withImage ? 'How should the photo move? The camera, the motion, the mood' : 'Describe the clip: the scene, the motion, the camera',
    placeHolder: withImage ? 'the camera slowly pushes in, hair moving in the wind' : 'a paper lantern drifting over a night river, slow push-in',
  });
  if (!prompt) return;
  const folder = outputFolder();
  if (!folder) return vscode.window.showErrorMessage('Open a folder first: Free Image to Video saves the MP4 into your workspace.');
  const editor = vscode.window.activeTextEditor;
  try {
    const file = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Free Image to Video', cancellable: false },
      async (progress) => {
        const client = new FreeImageToVideo({ apiKey: key });
        let imageUrl;
        if (image && image.local) {
          progress.report({ message: 'uploading the photo…' });
          const bytes = await vscode.workspace.fs.readFile(image.local);
          imageUrl = await client.uploadImage(bytes, MIME[path.extname(image.local.fsPath).toLowerCase()], path.basename(image.local.fsPath));
        } else if (image) imageUrl = image.url;
        progress.report({ message: 'submitting…' });
        const id = await client.submit(prompt, { imageUrl, options: settings() });
        progress.report({ message: 'making your clip with sound…' });
        const url = await client.wait(id, {
          timeoutMs: 30 * 60_000,
          onStatus: (d) => { if (d.queued) progress.report({ message: 'waiting in the queue…' }); },
        });
        progress.report({ message: 'saving…' });
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const target = vscode.Uri.joinPath(folder, `${slug(prompt)}-${Date.now().toString(36)}.mp4`);
        await vscode.workspace.fs.writeFile(target, bytes);
        return target;
      }
    );
    if (editor && ['markdown', 'mdx'].includes(editor.document.languageId)) {
      const rel = path.relative(path.dirname(editor.document.uri.fsPath), file.fsPath).split(path.sep).join('/');
      await editor.insertSnippet(new vscode.SnippetString(`<video src="${rel}" controls></video>`));
    }
    const pick = await vscode.window.showInformationMessage(`Saved ${vscode.workspace.asRelativePath(file)}`, 'Open');
    if (pick) vscode.commands.executeCommand('vscode.open', file);
  } catch (err) {
    reportError(err);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('freeimagetovideo.photoToVideo', (uri) => makeClip(context, { withImage: true, uri })),
    vscode.commands.registerCommand('freeimagetovideo.textToVideo', () => makeClip(context, { withImage: false })),
    vscode.commands.registerCommand('freeimagetovideo.showCredits', async () => {
      try {
        const n = await new FreeImageToVideo({ apiKey: await apiKey(context) }).credits();
        const a = await vscode.window.showInformationMessage(`Free Image to Video: ${n} credits left.`, 'See Plans');
        if (a) open('/pricing');
      } catch (err) {
        reportError(err);
      }
    }),
    vscode.commands.registerCommand('freeimagetovideo.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: 'Free Image to Video API key',
        prompt: 'From freeimagetovideo.ai/settings/apikeys. Stored in VS Code secret storage. Leave empty to remove.',
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      if (value.trim()) await context.secrets.store(SECRET, value.trim());
      else await context.secrets.delete(SECRET);
      vscode.window.showInformationMessage(value.trim() ? 'Free Image to Video API key saved.' : 'Free Image to Video API key removed.');
    })
  );
}

module.exports = { activate, deactivate() {} };
