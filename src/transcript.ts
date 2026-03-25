import { YT_HEADERS, extractJsonFromHtml } from './youtube-utils';

export interface TranscriptResult {
  videoId: string;
  title: string;
  transcript: string;
  language: string;
  isGenerated: boolean;
  method: string;
  success: true;
}

const BOOTSTRAP_URL = 'https://www.youtube.com';
const PLAYER_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const API_KEY_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_FETCH_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;

// Multiple client personalities to rotate through — reduces per-identity 429 pressure
const INNERTUBE_CLIENTS = [
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US; Pixel 8 Pro Build/AP1A.240505.004)',
    clientHeader: '3',
  },
  {
    clientName: 'ANDROID',
    clientVersion: '19.44.38',
    userAgent:
      'com.google.android.youtube/19.44.38 (Linux; U; Android 13; en_US; SM-G991B Build/TP1A.220624.014)',
    clientHeader: '3',
  },
  {
    clientName: 'IOS',
    clientVersion: '19.45.4',
    userAgent:
      'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
    clientHeader: '5',
  },
];

let clientRotationIdx = 0;
function nextClient() {
  const client = INNERTUBE_CLIENTS[clientRotationIdx % INNERTUBE_CLIENTS.length];
  clientRotationIdx++;
  return client;
}

let cachedInnertubeBootstrap:
  | { apiKey: string; visitorData: string | null; expiresAt: number }
  | null = null;

export function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  );
  return m?.[1] ?? null;
}

export async function getInnertubeApiKey(): Promise<string> {
  const bootstrap = await getInnertubeBootstrap();
  return bootstrap.apiKey;
}

export type TranscriptSafeResult =
  | (TranscriptResult & { success: true })
  | { videoId: string; success: false; error: string };

export async function extractTranscriptSafe(
  videoId: string,
  innertubeApiKey?: string | null,
): Promise<TranscriptSafeResult> {
  try {
    const result = await extractTranscript(videoId, innertubeApiKey);
    return result;
  } catch (e: any) {
    return { videoId, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extractTranscript(
  videoId: string,
  innertubeApiKey?: string | null,
): Promise<TranscriptResult> {
  const player = await resolvePlayerData(videoId, innertubeApiKey ?? null);
  const playbackError = getPlaybackError(player);
  if (playbackError) throw new Error(playbackError);

  const tracks: any[] | undefined =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('No captions available for this video');

  const track = selectBestTrack(tracks);
  const transcript = await fetchCaptions(track.baseUrl);
  const title: string = player?.videoDetails?.title || videoId;

  return {
    videoId,
    title,
    transcript,
    language: track.languageCode,
    isGenerated: track.kind === 'asr',
    method: 'caption-track',
    success: true,
  };
}

function selectBestTrack(tracks: any[]): any {
  return (
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === 'en') ||
    tracks[0]
  );
}

async function resolvePlayerData(videoId: string, innertubeApiKey: string | null): Promise<any> {
  let playerError: string | null = null;

  if (innertubeApiKey) {
    try {
      const player = await fetchPlayerData(videoId, innertubeApiKey);
      if (hasCaptionTracks(player)) return player;

      playerError = getPlaybackError(player);
      if (playerError && !shouldFallbackToWatchPage(playerError)) return player;
    } catch (error: any) {
      playerError = error instanceof Error ? error.message : String(error);
      if (!shouldFallbackToWatchPage(playerError)) throw error;
    }
  }

  try {
    const html = await fetchVideoPage(videoId);
    const player = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    if (!player) throw new Error('Could not extract player data from video page');
    return player;
  } catch (error: any) {
    if (playerError) throw new Error(playerError);
    throw error;
  }
}

async function fetchPlayerData(videoId: string, apiKey: string): Promise<any> {
  const url = new URL(PLAYER_API_URL);
  url.searchParams.set('key', apiKey);
  const visitorData = getCachedVisitorData(apiKey);
  const client = nextClient();

  const res = await fetchWithRetry(
    url.toString(),
    {
      method: 'POST',
      headers: {
        ...YT_HEADERS,
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
        'X-YouTube-Client-Name': client.clientHeader,
        'X-YouTube-Client-Version': client.clientVersion,
        ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: 'en',
            gl: 'US',
            ...(visitorData ? { visitorData } : {}),
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
    `YouTube player for ${videoId}`,
  );

  return res.json();
}

async function fetchVideoPage(videoId: string): Promise<string> {
  const res = await fetchWithRetry(
    `https://www.youtube.com/watch?v=${videoId}&hl=en`,
    { headers: YT_HEADERS },
    `YouTube watch page for ${videoId}`,
  );
  return res.text();
}

async function fetchCaptions(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'json3');

  const res = await fetchWithRetry(
    url.toString(),
    { headers: YT_HEADERS },
    'YouTube caption track',
  );
  const data: any = await res.json();

  const segments = (data.events || [])
    .filter((e: any) => e.segs)
    .map((e: any) => {
      const start = (e.tStartMs || 0) / 1000;
      const text = e.segs
        .map((s: any) => s.utf8 || '')
        .join('')
        .trim();
      return { start, text };
    })
    .filter((s: { text: string }) => s.text);

  if (!segments.length) throw new Error('Caption track was empty');

  return segments
    .map((s: { start: number; text: string }) => {
      const m = String(Math.floor(s.start / 60)).padStart(2, '0');
      const sec = String(Math.floor(s.start % 60)).padStart(2, '0');
      return `[${m}:${sec}] ${s.text}`;
    })
    .join('\n');
}

function hasCaptionTracks(player: any): boolean {
  return !!player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length;
}

function getPlaybackError(player: any): string | null {
  const status: string | undefined = player?.playabilityStatus?.status;
  if (!status || status === 'OK') return null;

  const reason = player?.playabilityStatus?.reason?.trim();
  const subreason = player?.playabilityStatus?.errorScreen
    ?.playerErrorMessageRenderer?.subreason?.runs
    ?.map((run: any) => run.text || '')
    .join('')
    .trim();

  return reason || subreason || `YouTube player returned ${status}`;
}

function shouldFallbackToWatchPage(errorMessage: string | null): boolean {
  if (!errorMessage) return true;
  const normalized = errorMessage.toLowerCase();
  return normalized.includes('not a bot') || normalized.includes('sign in to confirm');
}

function extractInnertubeApiKey(html: string): string | null {
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return match?.[1] ?? null;
}

function extractVisitorData(html: string): string | null {
  const match = html.match(/"visitorData":"([^"]+)"/);
  return match?.[1] ?? null;
}

async function getInnertubeBootstrap(): Promise<{
  apiKey: string;
  visitorData: string | null;
}> {
  if (cachedInnertubeBootstrap && cachedInnertubeBootstrap.expiresAt > Date.now()) {
    return cachedInnertubeBootstrap;
  }

  const res = await fetchWithRetry(BOOTSTRAP_URL, { headers: YT_HEADERS }, 'YouTube bootstrap');
  const html = await res.text();
  const apiKey = extractInnertubeApiKey(html);
  if (!apiKey) throw new Error('Could not bootstrap YouTube player API');

  cachedInnertubeBootstrap = {
    apiKey,
    visitorData: extractVisitorData(html),
    expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
  };

  return cachedInnertubeBootstrap;
}

function getCachedVisitorData(apiKey: string): string | null {
  if (!cachedInnertubeBootstrap || cachedInnertubeBootstrap.apiKey !== apiKey) return null;
  if (cachedInnertubeBootstrap.expiresAt <= Date.now()) return null;
  return cachedInnertubeBootstrap.visitorData;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  target: string,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(url, init);
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_FETCH_ATTEMPTS - 1) throw lastError;
      await wait(RETRY_BASE_DELAY_MS * 2 ** attempt);
      continue;
    }

    if (res.ok) return res;

    lastError = new Error(formatFetchError(target, res.status));
    if (!shouldRetryStatus(res.status) || attempt === MAX_FETCH_ATTEMPTS - 1) {
      throw lastError;
    }

    await wait(getRetryDelayMs(res, attempt));
  }

  throw lastError ?? new Error(`Failed to fetch ${target}`);
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function jitter(ms: number): number {
  // ±25% random jitter so concurrent requests don't all retry at the same moment
  return ms * (0.75 + Math.random() * 0.5);
}

function getRetryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return Math.min(jitter(seconds * 1000), 30000);

    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(jitter(at - Date.now()), 1000), 30000);
  }

  // Exponential back-off capped at 30 s for 429, with jitter
  return Math.min(jitter(RETRY_BASE_DELAY_MS * 2 ** attempt), 30000);
}

function formatFetchError(target: string, status: number): string {
  if (status === 429) return `${target} was rate-limited by YouTube (HTTP 429)`;
  return `${target} returned HTTP ${status}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
