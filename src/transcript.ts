import { YtCaptionKit, type HttpClient, type HttpResponse } from 'yt-caption-kit';
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

export type TranscriptSafeResult =
  | (TranscriptResult & { success: true })
  | { videoId: string; success: false; error: string };

/**
 * Custom HttpClient for yt-caption-kit that uses the global fetch API.
 * This ensures compatibility with Cloudflare Workers.
 */
class FetchHttpClient implements HttpClient {
  private cookies = new Map<string, string>();

  async get(url: string): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...YT_HEADERS };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const res = await fetch(url, { headers });
    return this.wrapResponse(res);
  }

  async postJson(url: string, body: unknown): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      ...YT_HEADERS,
      'Content-Type': 'application/json',
    };
    const cookieHeader = this.buildCookieHeader();
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return this.wrapResponse(res);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  private buildCookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([n, v]) => `${n}=${v}`)
      .join('; ');
  }

  private async wrapResponse(res: Response): Promise<HttpResponse> {
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  }
}

export function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  );
  return m?.[1] ?? null;
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

export async function extractTranscript(videoId: string): Promise<TranscriptResult> {
  const httpClient = new FetchHttpClient();
  const kit = new YtCaptionKit({ httpClient });

  // 1. Fetch transcript using the library (handles internal API calls/fallbacks)
  const transcript = await kit.fetch(videoId, { languages: ['en'] });

  // 2. Try to get the title from the video page (best effort)
  let title = videoId;
  try {
    const pageRes = await httpClient.get(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
    const html = await pageRes.text();
    const playerResponse = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
    if (playerResponse?.videoDetails?.title) {
      title = playerResponse.videoDetails.title;
    }
  } catch {
    // Ignore title fetch errors
  }

  return {
    videoId,
    title,
    transcript: formatTranscript(transcript),
    language: transcript.languageCode,
    isGenerated: transcript.isGenerated,
    method: 'yt-caption-kit',
    success: true,
  };
}

function formatTranscript(transcript: any): string {
  // Use 'any' for transcript because the snippets property is available at runtime
  const snippets = transcript.snippets || [];
  return snippets
    .map((s: any) => {
      const m = String(Math.floor(s.start / 60)).padStart(2, '0');
      const sec = String(Math.floor(s.start % 60)).padStart(2, '0');
      return `[${m}:${sec}] ${s.text}`;
    })
    .join('\n');
}

// Kept for backward compatibility if needed, but no longer used internally
export async function getInnertubeApiKey(): Promise<string> {
  return '';
}
