import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeChannel } from './channel';
import { extractTranscript, extractVideoId } from './transcript';
import { summarizeWithGemini } from './gemini';

const app = new Hono();

app.use('/api/*', cors());

app.post('/api/analyze_channel', async (c) => {
  const { channel_url, date_filter = 'all_time' } = await c.req.json();
  if (!channel_url) return c.json({ error: 'Channel URL is required' }, 400);

  try {
    const videos = await analyzeChannel(channel_url, date_filter);
    return c.json({ videos });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/extract_transcripts', async (c) => {
  const { video_urls = [] } = await c.req.json();
  if (!video_urls.length) return c.json({ error: 'No videos provided' }, 400);

  const results = await Promise.all(
    video_urls.map(async (url: string) => {
      const videoId = extractVideoId(url);
      if (!videoId) return { videoId: url, success: false, error: 'Invalid URL' };
      try {
        return await extractTranscript(videoId);
      } catch (e: any) {
        return { videoId, success: false, error: e.message };
      }
    }),
  );

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

export default app;
