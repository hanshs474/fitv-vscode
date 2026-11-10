# Free Image to Video for VS Code

Free image to video AI with no daily cap: start with no sign-up, keep going on a free account. Every video comes with sound and no watermark. This is the official VS Code extension for [Free Image to Video](https://freeimagetovideo.ai/?utm_source=vscode&utm_medium=extension): right-click a photo in the Explorer (or run a command) and the finished `.mp4` lands in your workspace.

With a Markdown file open (a README, docs, a changelog), a `<video>` tag for the new clip is inserted at the cursor, so a moving demo for your project is one command away. Every clip is [image to video AI with sound](https://freeimagetovideo.ai/video/image-to-video-ai-with-sound); prompts alone work too, the same way [free text to video AI](https://freeimagetovideo.ai/video/free-text-to-video-ai) does on the site.

| Command | What it does |
|---|---|
| **Free Image to Video: Photo to Video** | Pick a JPG / PNG / WebP (or right-click one in the Explorer, or paste an image URL), describe the motion, get an MP4 with the photo as the first frame |
| **Free Image to Video: Text to Video** | Prompt in, MP4 out |
| **Free Image to Video: Show Credits** | Credits left on your account (free to call) |
| **Free Image to Video: Set API Key** | Stores your key in VS Code's secret storage |

Clips are saved to `assets/` (configurable). Local photos are uploaded to freeimagetovideo.ai so the model can read them.

## Setup

1. Sign in on [freeimagetovideo.ai](https://freeimagetovideo.ai/?utm_source=vscode&utm_medium=extension) and create a key at [freeimagetovideo.ai/settings/apikeys](https://freeimagetovideo.ai/settings/apikeys).
2. Run **Free Image to Video: Set API Key** and paste it. (`FREEIMAGETOVIDEO_API_KEY` in the environment works too.)

API runs need a paid plan: each run draws on the plan's daily full-speed allowance, then waits in the relaxed queue; the extension keeps waiting and shows when a run is queued. Plans: [freeimagetovideo.ai/pricing](https://freeimagetovideo.ai/pricing?utm_source=vscode&utm_medium=extension). To make clips without a key, use the generator on the website: start with no sign-up, keep going on a free account.

## Settings

- `freeimagetovideo.outputFolder`: where new clips go (default `assets`)
- `freeimagetovideo.duration`: 4, 5, 6, 8, 10 or 15 seconds
- `freeimagetovideo.resolution`: 480p or 768p
- `freeimagetovideo.aspectRatio`: 16:9, 9:16 or 1:1

Model: MiniMax H3 (`minimax-h3`), the model the site runs.

MIT licensed. Source: [github.com/hanshs474/fitv-vscode](https://github.com/hanshs474/fitv-vscode). Questions: support@freeimagetovideo.ai.
