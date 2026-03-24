import { YT_HEADERS, extractJsonFromHtml } from './youtube-utils';

export interface Video {
  videoId: string;
  title: string;
  url: string;
  thumbnail: string;
  duration: string;
  views: string;
  publishedTimeText: string;
}

function parseRelativeDate(text: string): Date | null {
  const m = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  const d = new Date();
  switch (unit) {
    case 'second': d.setSeconds(d.getSeconds() - n); break;
    case 'minute': d.setMinutes(d.getMinutes() - n); break;
    case 'hour': d.setHours(d.getHours() - n); break;
    case 'day': d.setDate(d.getDate() - n); break;
    case 'week': d.setDate(d.getDate() - n * 7); break;
    case 'month': d.setMonth(d.getMonth() - n); break;
    case 'year': d.setFullYear(d.getFullYear() - n); break;
  }
  return d;
}

function passesDateFilter(publishedTimeText: string, filter: string): boolean {
  if (filter === 'all_time') return true;
  const pubDate = parseRelativeDate(publishedTimeText);
  if (!pubDate) return true;
  const now = new Date();
  switch (filter) {
    case 'this_month':
      return pubDate.getFullYear() === now.getFullYear() && pubDate.getMonth() === now.getMonth();
    case 'last_3_months': {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3);
      return pubDate >= cutoff;
    }
    case 'last_6_months': {
      const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6);
      return pubDate >= cutoff;
    }
    case 'this_year':
      return pubDate.getFullYear() === now.getFullYear();
    case 'last_year':
      return pubDate.getFullYear() === now.getFullYear() - 1;
    default:
      return true;
  }
}

export async function analyzeChannel(
  channelUrl: string,
  dateFilter: string,
): Promise<Video[]> {
  let videosUrl = channelUrl.replace(/\/+$/, '');
  if (!videosUrl.endsWith('/videos')) videosUrl += '/videos';

  const res = await fetch(videosUrl, { headers: YT_HEADERS });
  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status}`);
  const html = await res.text();

  const data = extractJsonFromHtml(html, 'ytInitialData');
  if (!data) throw new Error('Could not extract channel data from page');

  const videos: Video[] = [];
  collectVideos(data, videos, 500);

  const filtered = videos.filter((v) => passesDateFilter(v.publishedTimeText, dateFilter));
  if (!filtered.length) throw new Error('No videos found for the selected date range');
  return filtered;
}

function collectVideos(obj: any, videos: Video[], max: number): void {
  if (!obj || typeof obj !== 'object' || videos.length >= max) return;

  const renderer =
    obj.richItemRenderer?.content?.videoRenderer ||
    obj.gridVideoRenderer ||
    obj.videoRenderer;

  if (renderer?.videoId) {
    const id: string = renderer.videoId;
    if (!videos.some((v) => v.videoId === id)) {
      videos.push({
        videoId: id,
        title:
          renderer.title?.runs?.[0]?.text ||
          renderer.title?.simpleText ||
          id,
        url: `https://www.youtube.com/watch?v=${id}`,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration:
          renderer.lengthText?.simpleText ||
          renderer.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer
            ?.text?.simpleText ||
          'N/A',
        views:
          renderer.viewCountText?.simpleText ||
          renderer.viewCountText?.runs?.map((r: any) => r.text).join('') ||
          'N/A',
        publishedTimeText:
          renderer.publishedTimeText?.simpleText || '',
      });
    }
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) collectVideos(item, videos, max);
    } else if (typeof val === 'object') {
      collectVideos(val, videos, max);
    }
  }
}
