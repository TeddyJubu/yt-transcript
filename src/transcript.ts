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
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    hl: 'en',
    gl: 'US',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

async function fetchInnertubeApiKey(videoId: string): Promise<{ apiKey: string; html: string }> {
  // Pass consent cookie natively to avoid consent page HTTP 200 responses
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { ...YT_HEADERS, Cookie: 'CONSENT=YES+cb' },
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

function selectTrack(tracks: CaptionTrack[], languages: string[]): CaptionTrack | null {
  for (const lang of languages) {
    const manual = tracks.find((t) => t.languageCode === lang && t.kind !== 'asr');
    if (manual) return manual;
  }
  for (const lang of languages) {
    const asr = tracks.find((t) => t.languageCode === lang && t.kind === 'asr');
    if (asr) return asr;
  }
  return tracks[0] ?? null;
}

async function fetchCaptionXml(baseUrl: string): Promise<string> {
  const res = await fetch(baseUrl);
  if (!res.ok) throw new Error(`Caption fetch returned HTTP ${res.status}`);
  const xml = await res.text();
  return parseTranscriptXml(xml);
}

function parseTranscriptXml(xml: string): string {
  const lines: string[] = [];
  const regex = /<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(xml)) !== null) {
    const attrsStr = m[1];
    const raw = m[2];
    if (!raw) continue;

    let startSecs = 0;
    const startMatch = attrsStr.match(/\bstart="([^"]+)"/);
    if (startMatch) {
        startSecs = parseFloat(startMatch[1]);
    } else {
        const tMatch = attrsStr.match(/\bt="([^"]+)"/);
        if (tMatch) startSecs = parseFloat(tMatch[1]) / 1000;
    }

    const text = decodeEntities(stripTags(raw)).replace(/\n/g, ' ').trim();
    if (!text) continue;

    const mm = String(Math.floor(startSecs / 60)).padStart(2, '0');
    const ss = String(Math.floor(startSecs % 60)).padStart(2, '0');
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
  const { apiKey } = await fetchInnertubeApiKey(videoId);
  const playerData = await fetchInnertubePlayerData(videoId, apiKey);

  const playability = playerData?.playabilityStatus;
  const status = playability?.status;
  if (status && status !== 'OK') {
    const reason: string = playability?.reason ?? status;
    if (reason.includes('not a bot') || reason.includes('sign in') || status === 'LOGIN_REQUIRED') {
      throw new Error('YouTube bot-detection triggered — IP is blocked');
    }
    throw new Error(`Video unplayable: ${reason}`);
  }

  let title: string = playerData?.videoDetails?.title ?? videoId;

  const captionsData = playerData?.captions?.playerCaptionsTracklistRenderer;
  const tracks: CaptionTrack[] = captionsData?.captionTracks ?? [];

  if (!tracks.length) {
    throw new Error('No captions/transcripts available for this video');
  }

  const track = selectTrack(tracks, languages);
  if (!track) throw new Error('No suitable caption track found');

  const isGenerated = track.kind === 'asr';
  const language = track.languageCode;

  const transcript = await fetchCaptionXml(track.baseUrl);

  return {
    videoId,
    title,
    transcript,
    language,
    isGenerated,
    method: 'innertube-android',
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

export async function getInnertubeApiKey(): Promise<string> {
  return '';
}
