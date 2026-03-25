# yt-transcript

A Cloudflare Worker app for analyzing YouTube channels, extracting available captions, and optionally summarizing transcripts with Gemini.

## Runtime

The supported app surface is:

- [`wrangler.toml`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/wrangler.toml)
- [`src/index.ts`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/src/index.ts)
- [`public/index.html`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/public/index.html)

Legacy Python and Flask assets were archived to [`archive/legacy-python`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/archive/legacy-python) and are no longer part of the supported runtime.

## Setup

```bash
npm install
npm run dev
```

Useful commands:

- `npm run dev`: start the Worker locally with Wrangler
- `npm run typecheck`: run TypeScript checks
- `npm run deploy`: deploy the Worker

## API

The Worker keeps the existing API surface:

- `POST /api/analyze_channel`
- `POST /api/load_more_videos`
- `POST /api/extract_transcripts`
- `GET /api/extract_transcripts_stream`
- `POST /api/summarize`

`/api/extract_transcripts` and the SSE stream now return typed transcript failures with:

- `code`: one of `invalid_url`, `rate_limited`, `bot_challenge`, `login_required`, `no_captions`, `unplayable`, `owned_captions_unconfigured`, or `upstream_error`
- `retryable`: whether retry/backoff should treat the failure as transient

## Architecture

- Channel discovery:
  - [`src/channel.ts`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/src/channel.ts) loads the channel videos page and pagination continuations from YouTube.
- Transcript extraction:
  - [`src/transcript.ts`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/src/transcript.ts) uses a strategy layer.
  - `ownedCaptionsStrategy` is reserved for official YouTube Data API access to editable videos.
  - `publicCaptionsStrategy` is the default path for public videos through player data and `captionTracks`.
  - `sessionFallbackStrategy` is optional and only applies when session context is available.
- Streaming UX:
  - [`src/index.ts`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/src/index.ts) streams one result per video and backs off only for retryable blocking signals.
- Frontend:
  - [`public/index.html`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/public/index.html) provides the multi-step UI, SSE progress, downloads, and Gemini summarization.

## YouTube Blocking Notes

This project does not use browser automation or proxy-first scraping by default.

Known limitations:

- Cloud and shared IPs can be rate-limited or challenged by YouTube.
- Public caption access is undocumented and can change without notice.
- Some videos require login, have no captions, or are simply unavailable to this runtime.

Current mitigation:

- transcript failures are classified into retryable and non-retryable buckets
- the SSE extractor backs off on `rate_limited` and `bot_challenge`
- session-aware fallback is optional rather than always on

## Archive

Archived Python-era implementation and docs live in [`archive/legacy-python`](/Users/teddyburtonburger/Desktop/Code-hub/yt-transcript/archive/legacy-python).
