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

export function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  );
  return m?.[1] ?? null;
}

export async function extractTranscript(videoId: string): Promise<TranscriptResult> {
  const html = await fetchVideoPage(videoId);
  const player = extractJsonFromHtml(html, 'ytInitialPlayerResponse');
  if (!player) throw new Error('Could not extract player data from video page');

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

async function fetchVideoPage(videoId: string): Promise<string> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: YT_HEADERS,
  });
  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);
  return res.text();
}

async function fetchCaptions(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}&fmt=json3`);
  if (!res.ok) throw new Error('Failed to fetch caption data');
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

  return segments
    .map((s: { start: number; text: string }) => {
      const m = String(Math.floor(s.start / 60)).padStart(2, '0');
      const sec = String(Math.floor(s.start % 60)).padStart(2, '0');
      return `[${m}:${sec}] ${s.text}`;
    })
    .join('\n');
}
