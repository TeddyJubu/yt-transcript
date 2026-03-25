#!/usr/bin/env python3
"""
YouTube Transcript Extraction Toolkit
=====================================

This toolkit provides multiple methods to extract transcripts from YouTube videos.
Supports both individual videos and batch processing.

Requirements:
- youtube-transcript-api
- yt-dlp
- requests
- beautifulsoup4

Install with: pip install youtube-transcript-api yt-dlp requests beautifulsoup4
"""

import os
import json
import csv
import time
import re
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class YouTubeTranscriptExtractor:
    """Main class for extracting YouTube transcripts using multiple methods"""
    
    def __init__(self, output_dir: str = "transcripts"):
        self.output_dir = output_dir
        self.create_output_directory()
        
    def create_output_directory(self):
        """Create output directory structure"""
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(f"{self.output_dir}/individual", exist_ok=True)
        os.makedirs(f"{self.output_dir}/batch", exist_ok=True)
        os.makedirs(f"{self.output_dir}/logs", exist_ok=True)
        
    def extract_video_id(self, url: str) -> Optional[str]:
        """Extract video ID from YouTube URL"""
        patterns = [
            r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([^&\n?#]+)',
            r'youtube\.com/watch\?.*v=([^&\n?#]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    def method_1_youtube_transcript_api(self, video_id: str) -> Optional[Dict]:
        """Method 1: Using youtube-transcript-api (Most Reliable)"""
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            
            # Try to get transcript
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Prefer manually created transcripts over auto-generated
            transcript = None
            for t in transcript_list:
                if not t.is_generated:
                    transcript = t
                    break
            
            # If no manual transcript, use auto-generated
            if not transcript:
                transcript = transcript_list.find_transcript(['en'])
            
            # Fetch the transcript
            transcript_data = transcript.fetch()
            
            # Format transcript
            formatted_transcript = self.format_transcript(transcript_data)
            
            return {
                'method': 'youtube-transcript-api',
                'video_id': video_id,
                'language': transcript.language_code,
                'is_generated': transcript.is_generated,
                'transcript': formatted_transcript,
                'raw_data': transcript_data,
                'success': True
            }
            
        except Exception as e:
            logger.error(f"Method 1 failed for {video_id}: {str(e)}")
            return {'method': 'youtube-transcript-api', 'video_id': video_id, 'success': False, 'error': str(e)}
    
    def method_2_yt_dlp(self, video_id: str) -> Optional[Dict]:
        """Method 2: Using yt-dlp to extract subtitles"""
        try:
            import yt_dlp
            
            ydl_opts = {
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': ['en'],
                'skip_download': True,
                'outtmpl': f'{self.output_dir}/temp/%(id)s.%(ext)s'
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
                
                # Try to download subtitles
                ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
                
                # Look for subtitle files
                subtitle_files = []
                temp_dir = f'{self.output_dir}/temp'
                if os.path.exists(temp_dir):
                    for file in os.listdir(temp_dir):
                        if video_id in file and file.endswith('.vtt'):
                            subtitle_files.append(os.path.join(temp_dir, file))
                
                if subtitle_files:
                    # Read the first subtitle file
                    with open(subtitle_files[0], 'r', encoding='utf-8') as f:
                        vtt_content = f.read()
                    
                    # Parse VTT content
                    transcript = self.parse_vtt_content(vtt_content)
                    
                    # Cleanup temp files
                    for file in subtitle_files:
                        os.remove(file)
                    
                    return {
                        'method': 'yt-dlp',
                        'video_id': video_id,
                        'transcript': transcript,
                        'success': True
                    }
                else:
                    return {'method': 'yt-dlp', 'video_id': video_id, 'success': False, 'error': 'No subtitles found'}
                    
        except Exception as e:
            logger.error(f"Method 2 failed for {video_id}: {str(e)}")
            return {'method': 'yt-dlp', 'video_id': video_id, 'success': False, 'error': str(e)}
    
    def method_3_web_scraping(self, video_id: str) -> Optional[Dict]:
        """Method 3: Web scraping approach (Backup method)"""
        try:
            import requests
            from bs4 import BeautifulSoup
            
            # This is a simplified example - actual implementation would be more complex
            url = f"https://www.youtube.com/watch?v={video_id}"
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                # This would require more sophisticated parsing
                # For now, return a placeholder
                return {
                    'method': 'web-scraping',
                    'video_id': video_id,
                    'success': False,
                    'error': 'Web scraping method requires additional implementation'
                }
            else:
                return {'method': 'web-scraping', 'video_id': video_id, 'success': False, 'error': f'HTTP {response.status_code}'}
                
        except Exception as e:
            logger.error(f"Method 3 failed for {video_id}: {str(e)}")
            return {'method': 'web-scraping', 'video_id': video_id, 'success': False, 'error': str(e)}
    
    def format_transcript(self, transcript_data: List[Dict]) -> str:
        """Format transcript data into readable text"""
        formatted_lines = []
        
        for entry in transcript_data:
            timestamp = self.seconds_to_timestamp(entry['start'])
            text = entry['text'].strip()
            formatted_lines.append(f"[{timestamp}] {text}")
        
        return '\n'.join(formatted_lines)
    
    def parse_vtt_content(self, vtt_content: str) -> str:
        """Parse VTT subtitle content"""
        lines = vtt_content.split('\n')
        transcript_lines = []
        
        for line in lines:
            line = line.strip()
            if line and not line.startswith('WEBVTT') and '-->' not in line and not line.isdigit():
                # Remove HTML tags
                clean_line = re.sub(r'<[^>]+>', '', line)
                if clean_line:
                    transcript_lines.append(clean_line)
        
        return '\n'.join(transcript_lines)
    
    def seconds_to_timestamp(self, seconds: float) -> str:
        """Convert seconds to MM:SS or HH:MM:SS format"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        else:
            return f"{minutes:02d}:{secs:02d}"
    
    def extract_single_transcript(self, video_url: str, methods: List[str] = None) -> Dict:
        """Extract transcript for a single video using specified methods"""
        if methods is None:
            methods = ['youtube-transcript-api', 'yt-dlp', 'web-scraping']
        
        video_id = self.extract_video_id(video_url)
        if not video_id:
            return {'success': False, 'error': 'Invalid YouTube URL'}
        
        logger.info(f"Extracting transcript for video: {video_id}")
        
        results = []
        
        for method in methods:
            logger.info(f"Trying method: {method}")
            
            if method == 'youtube-transcript-api':
                result = self.method_1_youtube_transcript_api(video_id)
            elif method == 'yt-dlp':
                result = self.method_2_yt_dlp(video_id)
            elif method == 'web-scraping':
                result = self.method_3_web_scraping(video_id)
            else:
                continue
            
            results.append(result)
            
            if result and result.get('success'):
                logger.info(f"Successfully extracted transcript using {method}")
                return result
            
            # Wait between attempts to avoid rate limiting
            time.sleep(1)
        
        return {
            'video_id': video_id,
            'success': False,
            'error': 'All methods failed',
            'attempts': results
        }
    
    def extract_batch_transcripts(self, video_urls: List[str], delay: float = 2.0) -> List[Dict]:
        """Extract transcripts for multiple videos"""
        results = []
        
        logger.info(f"Starting batch extraction for {len(video_urls)} videos")
        
        for i, url in enumerate(video_urls, 1):
            logger.info(f"Processing video {i}/{len(video_urls)}")
            
            result = self.extract_single_transcript(url)
            results.append(result)
            
            # Save individual transcript if successful
            if result.get('success'):
                self.save_transcript(result)
            
            # Delay between requests to be respectful
            if i < len(video_urls):
                time.sleep(delay)
        
        # Save batch results
        self.save_batch_results(results)
        
        return results
    
    def save_transcript(self, result: Dict):
        """Save individual transcript to file"""
        if not result.get('success'):
            return
        
        video_id = result['video_id']
        transcript = result['transcript']
        
        # Save as text file
        txt_path = f"{self.output_dir}/individual/{video_id}.txt"
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(f"Video ID: {video_id}\n")
            f.write(f"Method: {result.get('method', 'unknown')}\n")
            f.write(f"Language: {result.get('language', 'unknown')}\n")
            f.write(f"Generated: {result.get('is_generated', 'unknown')}\n")
            f.write(f"Extracted: {datetime.now().isoformat()}\n")
            f.write("-" * 50 + "\n\n")
            f.write(transcript)
        
        # Save as markdown file
        md_path = f"{self.output_dir}/individual/{video_id}.md"
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(f"# Transcript: {video_id}\n\n")
            f.write(f"**Video ID:** {video_id}  \n")
            f.write(f"**Method:** {result.get('method', 'unknown')}  \n")
            f.write(f"**Language:** {result.get('language', 'unknown')}  \n")
            f.write(f"**Auto-generated:** {result.get('is_generated', 'unknown')}  \n")
            f.write(f"**Extracted:** {datetime.now().isoformat()}  \n\n")
            f.write("## Transcript\n\n")
            f.write(transcript)
        
        logger.info(f"Saved transcript for {video_id}")
    
    def save_batch_results(self, results: List[Dict]):
        """Save batch processing results"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save as JSON
        json_path = f"{self.output_dir}/batch/batch_results_{timestamp}.json"
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, default=str)
        
        # Save summary as CSV
        csv_path = f"{self.output_dir}/batch/batch_summary_{timestamp}.csv"
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Video ID', 'Success', 'Method', 'Error'])
            
            for result in results:
                writer.writerow([
                    result.get('video_id', 'unknown'),
                    result.get('success', False),
                    result.get('method', 'unknown'),
                    result.get('error', '')
                ])
        
        # Generate summary report
        successful = sum(1 for r in results if r.get('success'))
        failed = len(results) - successful
        
        report = f"""# Batch Transcript Extraction Report

**Date:** {datetime.now().isoformat()}
**Total Videos:** {len(results)}
**Successful:** {successful}
**Failed:** {failed}
**Success Rate:** {(successful/len(results)*100):.1f}%

## Failed Videos
{chr(10).join([f"- {r.get('video_id', 'unknown')}: {r.get('error', 'Unknown error')}" for r in results if not r.get('success')])}

## Files Generated
- Individual transcripts: {self.output_dir}/individual/
- Batch results: {json_path}
- Summary CSV: {csv_path}
"""
        
        report_path = f"{self.output_dir}/batch/report_{timestamp}.md"
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report)
        
        logger.info(f"Batch processing complete. {successful}/{len(results)} successful.")

# Example usage and testing
if __name__ == "__main__":
    # Initialize extractor
    extractor = YouTubeTranscriptExtractor()
    
    # Example: Extract single video transcript
    test_url = "https://www.youtube.com/watch?v=dXKzST0FE-A"
    result = extractor.extract_single_transcript(test_url)
    
    if result.get('success'):
        print("✅ Single extraction successful!")
        extractor.save_transcript(result)
    else:
        print("❌ Single extraction failed:", result.get('error'))
    
    # Example: Batch extraction (uncomment to test)
    # video_urls = [
    #     "https://www.youtube.com/watch?v=dXKzST0FE-A",
    #     "https://www.youtube.com/watch?v=VIDEO_ID_2"
    # ]
    # batch_results = extractor.extract_batch_transcripts(video_urls)
    
    print(f"Transcripts saved to: {extractor.output_dir}")