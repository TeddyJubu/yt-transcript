import { YT_HEADERS } from './youtube-utils';

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

// ─── Innertube constants ───────────────────────────────────────────────────────

const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  // Accept bare video IDs (11-char alphanumeric) as well as full URLs
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

/** Fetch the YouTube watch page and extract the innertube API key. */
async function fetchInnertubeApiKey(videoId: string): Promise<{ apiKey: string; html: string }> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: YT_HEADERS,
  });

  if (!res.ok) throw new Error(`YouTube watch page returned HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"/);
  if (!match?.[1]) {
    if (html.includes('class="g-recaptcha"') || html.includes('"isBot":true')) {
      throw new Error('IP blocked by YouTube (CAPTCHA detected)');
    }
    throw new Error('Could not extract INNERTUBE_API_KEY from YouTube page');
  }

  return { apiKey: match[1], html };
}

/** POST to the Innertube player endpoint and return the JSON response. */
async function fetchInnertubePlayerData(videoId: string, apiKey: string): Promise<any> {
  const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
  const body = {
    context: INNERTUBE_CONTEXT,
    videoId,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...YT_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Innertube player API returned HTTP ${res.status}`);
  return res.json();
}

interface CaptionTrack {
  baseUrl: string;
  name: { runs: { text: string }[] };
  languageCode: string;
  kind?: string;
}

/** Pick the best caption track for the requested language codes. */
function selectTrack(tracks: CaptionTrack[], languages: string[]): CaptionTrack | null {
  // Prefer manually-created transcripts first, then ASR
  for (const lang of languages) {
    const manual = tracks.find((t) => t.languageCode === lang && t.kind !== 'asr');
    if (manual) return manual;
  }
  for (const lang of languages) {
    const asr = tracks.find((t) => t.languageCode === lang && t.kind === 'asr');
    if (asr) return asr;
  }
  // Fallback: any track
  return tracks[0] ?? null;
}

/** Fetch and parse caption XML into timestamped lines. */
async function fetchCaptionXml(baseUrl: string): Promise<string> {
  const res = await fetch(baseUrl, { headers: YT_HEADERS });
  if (!res.ok) throw new Error(`Caption fetch returned HTTP ${res.status}`);
  const xml = await res.text();
  return parseTranscriptXml(xml);
}

function parseTranscriptXml(xml: string): string {
  const lines: string[] = [];
  const regex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(xml)) !== null) {
    const attrsStr = m[1];
    const raw = m[2];
    if (!raw) continue;

    // Parse start attribute
    const startMatch = attrsStr.match(/\bstart="([^"]+)"/);
    const start = startMatch ? parseFloat(startMatch[1]) : 0;

    // Decode HTML entities and strip tags
    const text = decodeEntities(stripTags(raw)).trim();
    if (!text) continue;

    const mm = String(Math.floor(start / 60)).padStart(2, '0');
    const ss = String(Math.floor(start % 60)).padStart(2, '0');
    lines.push(`[${mm}:${ss}] ${text}`);
  }

  return lines.join('\n');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractTranscript(
  videoId: string,
  languages = ['en', 'en-US'],
): Promise<TranscriptResult> {
  // 1. Get API key + raw HTML (for title)
  const { apiKey, html: watchHtml } = await fetchInnertubeApiKey(videoId);

  // 2. Fetch player data from Innertube
  const playerData = await fetchInnertubePlayerData(videoId, apiKey);

  // 3. Assert playability
  const playability = playerData?.playabilityStatus;
  const status = playability?.status;
  if (status && status !== 'OK') {
    const reason: string = playability?.reason ?? status;
    if (reason.includes('not a bot') || reason.includes('sign in') || status === 'LOGIN_REQUIRED') {
      throw new Error('YouTube bot-detection triggered — IP is blocked');
    }
    throw new Error(`Video unplayable: ${reason}`);
  }

  // 4. Extract title
  let title: string = playerData?.videoDetails?.title ?? videoId;

  // 5. Extract caption tracks
  const captionsData = playerData?.captions?.playerCaptionsTracklistRenderer;
  const tracks: CaptionTrack[] = captionsData?.captionTracks ?? [];

  if (!tracks.length) {
    throw new Error('No captions/transcripts available for this video');
  }

  // 6. Select best track
  const track = selectTrack(tracks, languages);
  if (!track) throw new Error('No suitable caption track found');

  const isGenerated = track.kind === 'asr';
  const language = track.languageCode;

  // 7. Fetch and parse caption XML
  const transcript = await fetchCaptionXml(track.baseUrl);

  return {
    videoId,
    title,
    transcript,
    language,
    isGenerated,
    method: 'innertube-direct',
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
