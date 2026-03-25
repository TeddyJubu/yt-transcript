import { YT_HEADERS } from './youtube-utils';

export interface TranscriptResult {
  videoId: string;
  title: string;
  transcript: string;
  language: string;
  isGenerated: boolean;
  method: string;
  success: true;
}

export type TranscriptFailureCode =
  | 'invalid_url'
  | 'rate_limited'
  | 'bot_challenge'
  | 'login_required'
  | 'no_captions'
  | 'unplayable'
  | 'owned_captions_unconfigured'
  | 'upstream_error';

export interface TranscriptFailureResult {
  videoId: string;
  success: false;
  error: string;
  code: TranscriptFailureCode;
  retryable: boolean;
  method?: string;
  title?: string;
}

export type TranscriptSafeResult = TranscriptResult | TranscriptFailureResult;

export interface TranscriptSessionContext {
  cookie?: string;
  visitorData?: string;
  poToken?: string;
  userAgent?: string;
  clientName?: 'ANDROID' | 'WEB';
  clientVersion?: string;
}

export interface TranscriptRuntimeOptions {
  session?: TranscriptSessionContext | null;
}

interface CaptionTrack {
  baseUrl: string;
  name: { runs: { text: string }[] };
  languageCode: string;
  kind?: string;
}

interface TranscriptStrategy {
  name: string;
  extract(
    videoId: string,
    languages: string[],
    options: TranscriptRuntimeOptions,
  ): Promise<TranscriptResult | null>;
}

interface ClientProfile {
  clientName: 'ANDROID' | 'WEB';
  clientVersion: string;
  method: string;
  pageMode: 'public' | 'session';
}

const DEFAULT_LANGUAGES = ['en', 'en-US'];
const BACKOFF_FAILURE_CODES = new Set<TranscriptFailureCode>(['rate_limited', 'bot_challenge']);

class TranscriptExtractionError extends Error {
  readonly code: TranscriptFailureCode;
  readonly retryable: boolean;
  readonly method?: string;

  constructor(
    code: TranscriptFailureCode,
    message: string,
    options: { retryable?: boolean; method?: string } = {},
  ) {
    super(message);
    this.name = 'TranscriptExtractionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.method = options.method;
  }
}

const ownedCaptionsStrategy: TranscriptStrategy = {
  name: 'youtube-data-api',
  async extract() {
    return null;
  },
};

const publicCaptionsStrategy: TranscriptStrategy = {
  name: 'innertube-android',
  async extract(videoId, languages) {
    return extractViaCaptionTracks(videoId, languages, {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      method: 'innertube-android',
      pageMode: 'public',
    });
  },
};

const sessionFallbackStrategy: TranscriptStrategy = {
  name: 'innertube-session',
  async extract(videoId, languages, options) {
    if (!options.session) return null;

    return extractViaCaptionTracks(videoId, languages, {
      clientName: options.session.clientName ?? 'WEB',
      clientVersion: options.session.clientVersion ?? '2.20250312.01.00',
      method: 'innertube-session',
      pageMode: 'session',
    }, options.session);
  },
};

const TRANSCRIPT_STRATEGIES: TranscriptStrategy[] = [
  ownedCaptionsStrategy,
  publicCaptionsStrategy,
  sessionFallbackStrategy,
];

export function extractVideoId(url: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

export function createTranscriptFailureResult(
  videoId: string,
  code: TranscriptFailureCode,
  error: string,
  retryable = false,
  extras: Pick<TranscriptFailureResult, 'method' | 'title'> = {},
): TranscriptFailureResult {
  return {
    videoId,
    success: false,
    error,
    code,
    retryable,
    ...extras,
  };
}

export function shouldBackOffTranscriptFailure(result: TranscriptSafeResult): boolean {
  return !result.success && BACKOFF_FAILURE_CODES.has(result.code);
}

export async function extractTranscript(
  videoId: string,
  languages = DEFAULT_LANGUAGES,
  options: TranscriptRuntimeOptions = {},
): Promise<TranscriptResult> {
  let lastError: TranscriptExtractionError | null = null;

  for (let i = 0; i < TRANSCRIPT_STRATEGIES.length; i++) {
    const strategy = TRANSCRIPT_STRATEGIES[i];
    try {
      const result = await strategy.extract(videoId, languages, options);
      if (result) return result;
    } catch (error) {
      const transcriptError = normalizeTranscriptError(error, strategy.name);
      lastError = transcriptError;

      const hasRemainingStrategies = i < TRANSCRIPT_STRATEGIES.length - 1;
      if (!shouldContinueAfterFailure(transcriptError, hasRemainingStrategies)) {
        throw transcriptError;
      }
    }
  }

  throw lastError ?? new TranscriptExtractionError(
    'upstream_error',
    'Transcript extraction failed before a supported strategy could complete.',
    { retryable: true },
  );
}

export async function extractTranscriptSafe(
  videoId: string,
  options: TranscriptRuntimeOptions = {},
): Promise<TranscriptSafeResult> {
  try {
    return await extractTranscript(videoId, DEFAULT_LANGUAGES, options);
  } catch (error) {
    const transcriptError = normalizeTranscriptError(error);
    return createTranscriptFailureResult(
      videoId,
      transcriptError.code,
      transcriptError.message,
      transcriptError.retryable,
      { method: transcriptError.method },
    );
  }
}

async function extractViaCaptionTracks(
  videoId: string,
  languages: string[],
  profile: ClientProfile,
  session?: TranscriptSessionContext,
): Promise<TranscriptResult> {
  const { apiKey } = await fetchInnertubeApiKey(videoId, session, profile.pageMode);
  const playerData = await fetchInnertubePlayerData(videoId, apiKey, profile, session);

  const playability = playerData?.playabilityStatus;
  const status = playability?.status;
  if (status && status !== 'OK') {
    const reason: string = playability?.reason ?? status;
    const lowered = reason.toLowerCase();

    if (status === 'LOGIN_REQUIRED' || lowered.includes('sign in')) {
      throw new TranscriptExtractionError(
        'login_required',
        'YouTube requires a logged-in session for this video.',
        { method: profile.method },
      );
    }

    if (lowered.includes('not a bot') || lowered.includes('unusual traffic')) {
      throw new TranscriptExtractionError(
        'bot_challenge',
        'YouTube challenged this request as suspicious traffic.',
        { method: profile.method, retryable: true },
      );
    }

    throw new TranscriptExtractionError(
      'unplayable',
      `Video unplayable: ${reason}`,
      { method: profile.method },
    );
  }

  const title: string = playerData?.videoDetails?.title ?? videoId;
  const captionsData = playerData?.captions?.playerCaptionsTracklistRenderer;
  const tracks: CaptionTrack[] = captionsData?.captionTracks ?? [];

  if (!tracks.length) {
    throw new TranscriptExtractionError(
      'no_captions',
      'No captions/transcripts are available for this video.',
      { method: profile.method },
    );
  }

  const track = selectTrack(tracks, languages);
  if (!track) {
    throw new TranscriptExtractionError(
      'no_captions',
      'No suitable caption track found for the requested languages.',
      { method: profile.method },
    );
  }

  const transcript = await fetchCaptionXml(track.baseUrl, profile.method, session);

  return {
    videoId,
    title,
    transcript,
    language: track.languageCode,
    isGenerated: track.kind === 'asr',
    method: profile.method,
    success: true,
  };
}

async function fetchInnertubeApiKey(
  videoId: string,
  session?: TranscriptSessionContext,
  pageMode: ClientProfile['pageMode'] = 'public',
): Promise<{ apiKey: string }> {
  const candidates = getPageCandidates(videoId, session, pageMode);
  let lastError: TranscriptExtractionError | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    try {
      if (i > 0) {
        await waitWithBackoff(i);
      }

      const res = await fetch(candidate.url, { headers: candidate.headers });
      if (res.status === 429) {
        throw new TranscriptExtractionError(
          'rate_limited',
          'YouTube rate-limited the transcript bootstrap request.',
          { retryable: true, method: candidate.method },
        );
      }
      if (!res.ok) {
        throw new TranscriptExtractionError(
          'upstream_error',
          `YouTube page request returned HTTP ${res.status}.`,
          { retryable: res.status >= 500, method: candidate.method },
        );
      }

      const html = await res.text();
      if (looksLikeBotChallenge(html)) {
        throw new TranscriptExtractionError(
          'bot_challenge',
          'YouTube presented a bot challenge while preparing transcript extraction.',
          { retryable: true, method: candidate.method },
        );
      }

      const apiKey = extractInnertubeApiKeyFromHtml(html);
      if (apiKey) return { apiKey };
    } catch (error) {
      lastError = normalizeTranscriptError(error, candidate.method);
    }
  }

  throw lastError ?? new TranscriptExtractionError(
    'upstream_error',
    'Could not discover the YouTube player bootstrap needed for captions.',
    { retryable: true },
  );
}

async function fetchInnertubePlayerData(
  videoId: string,
  apiKey: string,
  profile: ClientProfile,
  session?: TranscriptSessionContext,
): Promise<any> {
  const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
  const body = {
    context: {
      client: {
        clientName: profile.clientName,
        clientVersion: profile.clientVersion,
        hl: 'en',
        gl: 'US',
      },
    },
    videoId,
    ...(session?.poToken ? { serviceIntegrityDimensions: { poToken: session.poToken } } : {}),
  };

  const headers: Record<string, string> = {
    ...YT_HEADERS,
    'Content-Type': 'application/json',
  };

  if (session?.cookie) headers.Cookie = session.cookie;
  if (session?.visitorData) headers['X-Goog-Visitor-Id'] = session.visitorData;
  if (session?.userAgent) headers['User-Agent'] = session.userAgent;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new TranscriptExtractionError(
      'rate_limited',
      'YouTube rate-limited the player request.',
      { retryable: true, method: profile.method },
    );
  }

  if (!res.ok) {
    throw new TranscriptExtractionError(
      'upstream_error',
      `Innertube player API returned HTTP ${res.status}.`,
      { retryable: res.status >= 500, method: profile.method },
    );
  }

  return res.json();
}

function selectTrack(tracks: CaptionTrack[], languages: string[]): CaptionTrack | null {
  for (const lang of languages) {
    const manual = tracks.find((track) => track.languageCode === lang && track.kind !== 'asr');
    if (manual) return manual;
  }

  for (const lang of languages) {
    const asr = tracks.find((track) => track.languageCode === lang && track.kind === 'asr');
    if (asr) return asr;
  }

  return tracks[0] ?? null;
}

async function fetchCaptionXml(
  baseUrl: string,
  method: string,
  session?: TranscriptSessionContext,
): Promise<string> {
  const headers: Record<string, string> = {};

  if (session?.cookie) headers.Cookie = session.cookie;
  if (session?.userAgent) headers['User-Agent'] = session.userAgent;

  const res = await fetch(baseUrl, Object.keys(headers).length ? { headers } : undefined);

  if (res.status === 429) {
    throw new TranscriptExtractionError(
      'rate_limited',
      'YouTube rate-limited the caption download request.',
      { retryable: true, method },
    );
  }

  if (!res.ok) {
    throw new TranscriptExtractionError(
      'upstream_error',
      `Caption fetch returned HTTP ${res.status}.`,
      { retryable: res.status >= 500, method },
    );
  }

  return parseTranscriptXml(await res.text());
}

function parseTranscriptXml(xml: string): string {
  const lines: string[] = [];
  const regex = /<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const attrsStr = match[1];
    const raw = match[2];
    if (!raw) continue;

    let startSecs = 0;
    const startMatch = attrsStr.match(/\bstart="([^"]+)"/);
    if (startMatch) {
      startSecs = parseFloat(startMatch[1]);
    } else {
      const timeMatch = attrsStr.match(/\bt="([^"]+)"/);
      if (timeMatch) startSecs = parseFloat(timeMatch[1]) / 1000;
    }

    const text = decodeEntities(stripTags(raw)).replace(/\n/g, ' ').trim();
    if (!text) continue;

    const mm = String(Math.floor(startSecs / 60)).padStart(2, '0');
    const ss = String(Math.floor(startSecs % 60)).padStart(2, '0');
    lines.push(`[${mm}:${ss}] ${text}`);
  }

  return lines.join('\n');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function getPageCandidates(
  videoId: string,
  session?: TranscriptSessionContext,
  pageMode: ClientProfile['pageMode'] = 'public',
): Array<{ url: string; headers: Record<string, string>; method: string }> {
  const consentCookie = session?.cookie ? `${session.cookie}; CONSENT=YES+cb` : 'CONSENT=YES+cb';

  const desktopHeaders: Record<string, string> = {
    ...YT_HEADERS,
    Cookie: consentCookie,
  };

  const mobileHeaders: Record<string, string> = {
    'User-Agent':
      session?.userAgent ??
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: consentCookie,
  };

  if (session?.visitorData) {
    desktopHeaders['X-Goog-Visitor-Id'] = session.visitorData;
    mobileHeaders['X-Goog-Visitor-Id'] = session.visitorData;
  }

  if (session?.userAgent && pageMode === 'session') {
    desktopHeaders['User-Agent'] = session.userAgent;
  }

  return [
    {
      url: `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      headers: desktopHeaders,
      method: pageMode === 'session' ? 'session-watch-page' : 'public-watch-page',
    },
    {
      url: `https://www.youtube.com/embed/${videoId}?hl=en`,
      headers: mobileHeaders,
      method: pageMode === 'session' ? 'session-embed-page' : 'public-embed-page',
    },
  ];
}

function extractInnertubeApiKeyFromHtml(html: string): string | null {
  const primaryMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"/);
  if (primaryMatch?.[1]) return primaryMatch[1];

  const secondaryMatch = html.match(/"innertubeApiKey"\s*:\s*"([a-zA-Z0-9_-]+)"/);
  return secondaryMatch?.[1] ?? null;
}

function looksLikeBotChallenge(html: string): boolean {
  const lowered = html.toLowerCase();
  return (
    lowered.includes('g-recaptcha') ||
    lowered.includes('"isbot":true') ||
    lowered.includes('unusual traffic') ||
    lowered.includes('/sorry/')
  );
}

function shouldContinueAfterFailure(
  error: TranscriptExtractionError,
  hasRemainingStrategies: boolean,
): boolean {
  if (!hasRemainingStrategies) return false;

  return error.code === 'rate_limited'
    || error.code === 'bot_challenge'
    || error.code === 'login_required'
    || error.code === 'upstream_error'
    || error.code === 'owned_captions_unconfigured';
}

function normalizeTranscriptError(
  error: unknown,
  method?: string,
): TranscriptExtractionError {
  if (error instanceof TranscriptExtractionError) return error;

  if (error instanceof Error) {
    return new TranscriptExtractionError(
      'upstream_error',
      error.message,
      { retryable: true, method },
    );
  }

  return new TranscriptExtractionError(
    'upstream_error',
    String(error),
    { retryable: true, method },
  );
}

async function waitWithBackoff(attempt: number): Promise<void> {
  const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 250;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
