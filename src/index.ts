import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeChannel, fetchNextPage } from './channel';
import {
  createTranscriptFailureResult,
  extractTranscriptSafe,
  extractVideoId,
  shouldBackOffTranscriptFailure,
  type TranscriptSafeResult,
} from './transcript';
import { summarizeWithGemini } from './gemini';

const app = new Hono();
const EXTRACTION_DELAY_MS = 1500;

/** Adaptive pacer — backs off when YouTube is returning 429s */
class AdaptivePacer {
  private delay: number;
  private consecutiveSuccesses = 0;
  private readonly base: number;
  private readonly max: number;

  constructor(baseMs = 1500, maxMs = 12000) {
    this.base = baseMs;
    this.max = maxMs;
    this.delay = baseMs;
  }

  recordSuccess() {
    this.consecutiveSuccesses++;
    if (this.consecutiveSuccesses >= 3 && this.delay > this.base) {
      this.delay = Math.max(this.base, Math.floor(this.delay / 2));
      this.consecutiveSuccesses = 0;
    }
  }

  recordRateLimit() {
    this.consecutiveSuccesses = 0;
    this.delay = Math.min(this.delay * 2, this.max);
  }

  async wait() {
    const jittered = this.delay * (0.85 + Math.random() * 0.3);
    await new Promise<void>((r) => setTimeout(r, jittered));
  }

  currentDelay() { return this.delay; }
}

app.use('/api/*', cors());

app.onError((err, c) => {
  console.error('Worker Error:', err);
  return c.json({ 
    error: err.message, 
    stack: err.stack,
    type: err.name 
  }, 500);
});

app.post('/api/analyze_channel', async (c) => {
  const { channel_url, date_filter = 'all_time' } = await c.req.json();
  if (!channel_url) return c.json({ error: 'Channel URL is required' }, 400);

  try {
    const page = await analyzeChannel(channel_url, date_filter);
    return c.json({
      videos: page.videos,
      continuation_token: page.continuationToken ?? null,
      has_more: page.hasMore,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/load_more_videos', async (c) => {
  const { continuation_token, date_filter = 'all_time' } = await c.req.json();
  if (!continuation_token) return c.json({ error: 'continuation_token is required' }, 400);

  try {
    const page = await fetchNextPage(continuation_token, date_filter);
    return c.json({
      videos: page.videos,
      continuation_token: page.continuationToken ?? null,
      has_more: page.hasMore,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/extract_transcripts', async (c) => {
  const { video_urls = [] } = await c.req.json();
  if (!video_urls.length) return c.json({ error: 'No videos provided' }, 400);

  const results: TranscriptSafeResult[] = [];
  for (let i = 0; i < video_urls.length; i++) {
    const url = video_urls[i];
    const videoId = extractVideoId(url);
    if (!videoId) {
      results.push(createTranscriptFailureResult(url, 'invalid_url', 'Invalid URL'));
    } else {
      results.push(await extractTranscriptSafe(videoId));
    }

    if (i < video_urls.length - 1) await delay(EXTRACTION_DELAY_MS);
  }

  return c.json({ results });
});

app.post('/api/summarize', async (c) => {
  const { api_key, transcript, title } = await c.req.json();
  if (!api_key) return c.json({ error: 'Gemini API key is required' }, 400);
  if (!transcript) return c.json({ error: 'Transcript is required' }, 400);

  try {
    const summary = await summarizeWithGemini(api_key, transcript, title || 'Untitled');
    return c.json({ summary });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── SSE Streaming Endpoint ───────────────────────────────────────────────
// GET /api/extract_transcripts_stream?urls=["url1","url2",...]
// Streams one SSE event per video so the frontend can show live progress.
// Events:
//   event: progress  data: { current, total, videoId }
//   event: result    data: { ...TranscriptSafeResult }
//   event: done      data: { total, succeeded, failed }
//   event: error     data: { error }
app.get('/api/extract_transcripts_stream', async (c) => {
  const rawUrls = c.req.query('urls');
  let videoUrls: string[] = [];
  try {
    videoUrls = JSON.parse(rawUrls ?? '[]');
  } catch {
    return c.text('Invalid urls parameter', 400);
  }
  if (!videoUrls.length) return c.text('No videos provided', 400);

  // Resolve video IDs up-front so we can report invalid URLs immediately
  const items: Array<{ url: string; videoId: string | null }> = videoUrls.map((url) => ({
    url,
    videoId: extractVideoId(url),
  }));

  const pacer = new AdaptivePacer();
  const encoder = new TextEncoder();
  const total = items.length;

  function sseEvent(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        const { url, videoId } = items[i];

        // Emit progress before starting this video
        controller.enqueue(sseEvent('progress', { current: i + 1, total, videoId: videoId ?? url }));

        let result: TranscriptSafeResult;
        if (!videoId) {
          result = createTranscriptFailureResult(url, 'invalid_url', 'Invalid URL');
          failed++;
        } else {
          result = await extractTranscriptSafe(videoId);
          if (result.success) {
            succeeded++;
            pacer.recordSuccess();
          } else {
            failed++;
            if (shouldBackOffTranscriptFailure(result)) {
              pacer.recordRateLimit();
            }
          }
        }

        controller.enqueue(sseEvent('result', result));

        // Wait between videos (skip after last)
        if (i < items.length - 1) await pacer.wait();
      }

      controller.enqueue(sseEvent('done', { total, succeeded, failed }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export default app;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
