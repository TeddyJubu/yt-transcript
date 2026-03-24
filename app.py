#!/usr/bin/env python3
"""
YouTube Transcript Web App
==========================

A Flask web application for extracting YouTube channel transcripts
and integrating with NotebookLM via MCP CLI.
"""

from flask import Flask, render_template, request, jsonify, send_file, session
from flask_socketio import SocketIO, emit
import os
import json
import uuid
import threading
import time
from datetime import datetime
import subprocess
import zipfile
import shutil
from pathlib import Path

# Import our existing transcript extraction modules
import sys
sys.path.insert(0, 'transcript_toolkit')
from youtube_transcript_extractor import YouTubeTranscriptExtractor
from youtube_channel_analyzer import YouTubeChannelAnalyzer

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['UPLOAD_FOLDER'] = 'outputs'
socketio = SocketIO(app, cors_allowed_origins="*")

# Global storage for processing jobs
processing_jobs = {}

class TranscriptWebApp:
    def __init__(self):
        self.setup_directories()
        
    def setup_directories(self):
        """Create necessary directories"""
        directories = [
            'outputs',
            'temp',
            'static/downloads',
            'templates'
        ]
        
        for directory in directories:
            Path(directory).mkdir(parents=True, exist_ok=True)

# Initialize the app
webapp = TranscriptWebApp()

@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')

@app.route('/api/analyze_channel', methods=['POST'])
def analyze_channel():
    """Analyze YouTube channel and get video list"""
    try:
        data = request.json
        channel_url = data.get('channel_url')
        max_videos = data.get('max_videos', 50)
        
        if not channel_url:
            return jsonify({'error': 'Channel URL is required'}), 400
        
        # Create job ID
        job_id = str(uuid.uuid4())
        
        # Start analysis in background
        thread = threading.Thread(
            target=analyze_channel_background,
            args=(job_id, channel_url, max_videos)
        )
        thread.start()
        
        return jsonify({
            'job_id': job_id,
            'status': 'started',
            'message': 'Channel analysis started'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

FIRST_PAGE_SIZE = 30

def analyze_channel_background(job_id, channel_url, max_videos):
    """Background task for channel analysis"""
    try:
        processing_jobs[job_id] = {
            'status': 'analyzing',
            'progress': 0,
            'message': 'Analyzing channel...',
            'videos': [],
            'all_videos': [],
            'error': None
        }

        socketio.emit('progress_update', {
            'job_id': job_id,
            'status': 'analyzing',
            'progress': 10,
            'message': 'Discovering videos...'
        })

        analyzer = YouTubeChannelAnalyzer()

        # Fetch all video metadata at once using yt-dlp flat extraction
        all_videos = analyzer.get_all_channel_videos_flat(channel_url)

        first_page = all_videos[:FIRST_PAGE_SIZE]
        total = len(all_videos)
        has_more = total > FIRST_PAGE_SIZE

        processing_jobs[job_id].update({
            'status': 'completed',
            'progress': 100,
            'message': f'Found {total} videos',
            'videos': first_page,
            'all_videos': all_videos,
            'total_videos': total,
        })

        socketio.emit('analysis_complete', {
            'job_id': job_id,
            'videos': first_page,
            'total': total,
            'has_more': has_more,
        })

    except Exception as e:
        processing_jobs[job_id] = {
            'status': 'error',
            'progress': 0,
            'message': f'Error: {str(e)}',
            'videos': [],
            'all_videos': [],
            'error': str(e)
        }

        socketio.emit('analysis_error', {
            'job_id': job_id,
            'error': str(e)
        })

@app.route('/api/load_more_videos', methods=['POST'])
def load_more_videos():
    """Return the next page of videos from a cached analysis job"""
    try:
        data = request.json
        job_id = data.get('job_id')
        offset = int(data.get('offset', 0))
        limit = int(data.get('limit', FIRST_PAGE_SIZE))

        if not job_id or job_id not in processing_jobs:
            return jsonify({'error': 'Job not found'}), 404

        job = processing_jobs[job_id]
        all_videos = job.get('all_videos', [])

        page_videos = all_videos[offset:offset + limit]
        has_more = (offset + limit) < len(all_videos)

        return jsonify({
            'videos': page_videos,
            'has_more': has_more,
            'offset': offset,
            'total': len(all_videos),
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/extract_transcripts', methods=['POST'])
def extract_transcripts():
    """Start transcript extraction process"""
    try:
        data = request.json
        video_urls = data.get('video_urls', [])
        output_format = data.get('format', 'both')  # txt, md, both
        notebooklm_integration = data.get('notebooklm', False)
        
        if not video_urls:
            return jsonify({'error': 'No videos selected'}), 400
        
        # Create job ID
        job_id = str(uuid.uuid4())
        
        # Start extraction in background
        thread = threading.Thread(
            target=extract_transcripts_background,
            args=(job_id, video_urls, output_format, notebooklm_integration)
        )
        thread.start()
        
        return jsonify({
            'job_id': job_id,
            'status': 'started',
            'message': 'Transcript extraction started'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def extract_transcripts_background(job_id, video_urls, output_format, notebooklm_integration):
    """Background task for transcript extraction"""
    try:
        # Initialize job status
        processing_jobs[job_id] = {
            'status': 'extracting',
            'progress': 0,
            'message': 'Starting extraction...',
            'completed': 0,
            'total': len(video_urls),
            'files': [],
            'error': None
        }
        
        # Create output directory for this job
        output_dir = f"outputs/{job_id}"
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        
        # Initialize extractor
        extractor = YouTubeTranscriptExtractor(output_dir=output_dir)
        
        completed_files = []
        
        for i, video_url in enumerate(video_urls):
            try:
                # Update progress
                progress = int((i / len(video_urls)) * 90)  # Reserve 10% for final steps
                processing_jobs[job_id].update({
                    'progress': progress,
                    'message': f'Processing video {i+1}/{len(video_urls)}...',
                    'completed': i
                })
                
                socketio.emit('extraction_progress', {
                    'job_id': job_id,
                    'progress': progress,
                    'message': f'Processing video {i+1}/{len(video_urls)}...',
                    'completed': i,
                    'total': len(video_urls)
                })
                
                # Extract transcript
                result = extractor.extract_single_transcript(video_url)
                
                if result.get('success'):
                    # Save transcript in requested format(s)
                    files = save_transcript_files(result, output_dir, output_format)
                    completed_files.extend(files)
                    
                    processing_jobs[job_id]['completed'] = i + 1
                
                # Small delay to avoid rate limiting
                time.sleep(1)
                
            except Exception as e:
                print(f"Error processing video {video_url}: {e}")
                continue
        
        # Create zip file with all transcripts
        zip_path = create_transcript_zip(job_id, output_dir, completed_files)
        
        # NotebookLM integration if requested
        notebooklm_result = None
        if notebooklm_integration and completed_files:
            notebooklm_result = integrate_with_notebooklm(job_id, completed_files)
        
        # Final update
        processing_jobs[job_id].update({
            'status': 'completed',
            'progress': 100,
            'message': f'Completed! Extracted {len(completed_files)} transcripts',
            'files': completed_files,
            'zip_path': zip_path,
            'notebooklm_result': notebooklm_result
        })
        
        socketio.emit('extraction_complete', {
            'job_id': job_id,
            'files': completed_files,
            'zip_path': zip_path,
            'notebooklm_result': notebooklm_result
        })
        
    except Exception as e:
        processing_jobs[job_id] = {
            'status': 'error',
            'progress': 0,
            'message': f'Error: {str(e)}',
            'completed': 0,
            'total': len(video_urls),
            'files': [],
            'error': str(e)
        }
        
        socketio.emit('extraction_error', {
            'job_id': job_id,
            'error': str(e)
        })

def save_transcript_files(result, output_dir, output_format):
    """Save transcript in requested format(s)"""
    files = []
    video_id = result.get('video_id', 'unknown')
    transcript = result.get('transcript', '')
    
    # Create metadata header
    metadata = f"""Video ID: {video_id}
Method: {result.get('method', 'unknown')}
Language: {result.get('language', 'unknown')}
Auto-generated: {result.get('is_generated', 'unknown')}
Extracted: {datetime.now().isoformat()}
{'='*50}

"""
    
    if output_format in ['txt', 'both']:
        # Save as TXT
        txt_path = f"{output_dir}/{video_id}.txt"
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(metadata + transcript)
        files.append(txt_path)
    
    if output_format in ['md', 'both']:
        # Save as Markdown
        md_path = f"{output_dir}/{video_id}.md"
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(f"# Transcript: {video_id}\n\n")
            f.write(f"**Video ID:** {video_id}  \n")
            f.write(f"**Method:** {result.get('method', 'unknown')}  \n")
            f.write(f"**Language:** {result.get('language', 'unknown')}  \n")
            f.write(f"**Auto-generated:** {result.get('is_generated', 'unknown')}  \n")
            f.write(f"**Extracted:** {datetime.now().isoformat()}  \n\n")
            f.write("## Transcript\n\n")
            f.write(transcript)
        files.append(md_path)
    
    return files

def create_transcript_zip(job_id, output_dir, files):
    """Create zip file with all transcripts"""
    zip_path = f"static/downloads/{job_id}_transcripts.zip"
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for file_path in files:
            if os.path.exists(file_path):
                arcname = os.path.basename(file_path)
                zipf.write(file_path, arcname)
    
    return zip_path

def integrate_with_notebooklm(job_id, transcript_files):
    """Integrate with NotebookLM using MCP CLI"""
    try:
        # Check if notebooklm-mcp-cli is available
        result = subprocess.run(['which', 'notebooklm-mcp-cli'], 
                              capture_output=True, text=True)
        
        if result.returncode != 0:
            return {
                'success': False,
                'error': 'NotebookLM MCP CLI not found. Please install it first.',
                'install_instructions': 'Run: npm install -g notebooklm-mcp-cli'
            }
        
        # Prepare transcript content for NotebookLM
        combined_content = ""
        for file_path in transcript_files:
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    combined_content += f"\n\n--- {os.path.basename(file_path)} ---\n\n"
                    combined_content += content
        
        # Create temporary file for NotebookLM
        temp_file = f"temp/{job_id}_combined.txt"
        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(combined_content)
        
        # Send to NotebookLM
        cmd = ['notebooklm-mcp-cli', 'upload', temp_file]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            return {
                'success': True,
                'message': 'Successfully uploaded to NotebookLM',
                'output': result.stdout
            }
        else:
            return {
                'success': False,
                'error': f'NotebookLM upload failed: {result.stderr}',
                'output': result.stdout
            }
            
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': 'NotebookLM upload timed out'
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'NotebookLM integration error: {str(e)}'
        }

@app.route('/api/job_status/<job_id>')
def get_job_status(job_id):
    """Get status of a processing job"""
    if job_id in processing_jobs:
        return jsonify(processing_jobs[job_id])
    else:
        return jsonify({'error': 'Job not found'}), 404

@app.route('/download/<path:filename>')
def download_file(filename):
    """Download generated files"""
    file_path = f"static/downloads/{filename}"
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
    else:
        return "File not found", 404

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    print('Client disconnected')

if __name__ == '__main__':
    # Create required directories
    webapp.setup_directories()
    
    # Run the app
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)