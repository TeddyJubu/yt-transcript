import { YT_HEADERS } from './youtube-utils';
import { YtCaptionKit } from 'yt-caption-kit';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptResult {
  videoId: string;
  title: string;
  transcript: string;
  language: string;
  isGenerated: boolean;
  method: string;
  success: true;
}

export type TranscriptSafeResult =
  | (TranscriptResult & { success: true })
  | { videoId: string; success: false; error: string };

const _captionKitApi = new YtCaptionKit();

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCEPT_LANGUAGE_HEADER = 'en-US';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  // Accept bare video IDs (11-char alphanumeric) as well as full URLs
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

/** Fetch the YouTube watch page and extract the player response JSON. */
async function fetchWatchPageAndExtractPlayer(videoId: string): Promise<any> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(url, {
    headers: {
      ...YT_HEADERS,
      'Accept-Language': ACCEPT_LANGUAGE_HEADER,
    },
  });

  if (!res.ok) throw new Error(`YouTube watch page returned HTTP ${res.status}`);
  const html = await res.text();

  // The 'youtube-transcript-api' extraction approach: finding the embedded ytInitialPlayerResponse
  const match1 = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*var meta\s*=/);
  const match2 = html.match(/var ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*</);
  const match3 = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*<\/script>/);
  
  const jsonStr = match1?.[1] || match2?.[1] || match3?.[1];

  if (!jsonStr) {
    if (html.includes('class="g-recaptcha"') || html.includes('"isBot":true') || html.includes('consent.youtube.com')) {
      throw new Error('IP blocked by YouTube (CAPTCHA or Consent or Bot detected)');
    }
    throw new Error('Could not extract ytInitialPlayerResponse from YouTube page');
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Failed to parse ytInitialPlayerResponse JSON');
  }
}

interface CaptionTrack {
  baseUrl: string;
  name: { runs: { text: string }[] };
  languageCode: string;
  kind?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractTranscript(
  videoId: string,
  languages = ['en', 'en-US'],
): Promise<TranscriptResult> {
  // 1. Fetch title from watch page HTML (fallback to videoId if blocked)
  let title = videoId;
  try {
    const playerData = await fetchWatchPageAndExtractPlayer(videoId);
    const playability = playerData?.playabilityStatus;
    const status = playability?.status;
    if (status && status !== 'OK') {
      const reason: string = playability?.reason ?? status;
      if (reason.includes('not a bot') || reason.includes('sign in') || status === 'LOGIN_REQUIRED') {
         // Silently ignore here to let caption kit try or fail naturally
      } else {
         throw new Error(`Video unplayable: ${reason}`);
      }
    }
    title = playerData?.videoDetails?.title ?? videoId;
  } catch(e) {
    // If we fail to get the title, don't abort, try fetching captions anyway.
  }

  // 2. Fetch transcript via yt-caption-kit
  const track = await _captionKitApi.fetch(videoId, { languages });
  
  if (!track || !track.snippets || !track.snippets.length) {
      throw new Error('No suitable caption track found or empty text returned');
  }

  // 3. Format into [MM:SS] Text
  const lines = track.snippets.map((snip: any) => {
    const start = snip.start;
    const mm = String(Math.floor(start / 60)).padStart(2, '0');
    const ss = String(Math.floor(start % 60)).padStart(2, '0');
    const text = snip.text.replace(/\n/g, ' ').trim();
    return `[${mm}:${ss}] ${text}`;
  });

  return {
    videoId,
    title,
    transcript: lines.join('\n'),
    language: track.languageCode,
    isGenerated: track.isGenerated,
    method: 'yt-caption-kit',
    success: true,
  };
}

export async function extractTranscriptSafe(
  videoId: string,
  _innertubeApiKey?: string | null,
): Promise<TranscriptSafeResult> {
  try {
    const result = await extractTranscript(videoId);
    return result;
  } catch (e: any) {
    return {
      videoId,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Kept for backward compatibility
export async function getInnertubeApiKey(): Promise<string> {
  return '';
}
