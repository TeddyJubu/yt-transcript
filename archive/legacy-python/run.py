#!/usr/bin/env python3
"""
YouTube Transcript Web App Launcher
===================================

Simple launcher script with automatic setup and configuration.
"""

import os
import sys
import subprocess
from pathlib import Path

def check_setup():
    """Check if the app is properly set up"""
    required_files = [
        'app.py',
        'requirements.txt',
        'templates/index.html',
        'youtube_channel_analyzer.py'
    ]
    
    missing_files = []
    for file in required_files:
        if not Path(file).exists():
            missing_files.append(file)
    
    if missing_files:
        print("❌ Missing required files:")
        for file in missing_files:
            print(f"   - {file}")
        print("\nPlease run: python setup.py")
        return False
    
    return True

def check_dependencies():
    """Check if dependencies are installed"""
    try:
        import flask
        import flask_socketio
        import youtube_transcript_api
        return True
    except ImportError as e:
        print(f"❌ Missing dependencies: {e}")
        print("Please run: python setup.py")
        return False

def main():
    """Main launcher function"""
    print("🎬 YouTube Transcript Web App Launcher")
    print("=" * 45)
    
    # Check setup
    if not check_setup():
        sys.exit(1)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Set environment variables
    os.environ['FLASK_ENV'] = 'development'
    
    print("✅ All checks passed!")
    print("🚀 Starting web application...")
    print("📱 Open your browser to: http://localhost:5000")
    print("⏹️  Press Ctrl+C to stop the server")
    print("-" * 45)
    
    # Import and run the app
    try:
        from app import app, socketio
        socketio.run(app, debug=True, host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        print("\n👋 Shutting down gracefully...")
    except Exception as e:
        print(f"❌ Error starting app: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()