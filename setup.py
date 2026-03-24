#!/usr/bin/env python3
"""
Setup script for YouTube Transcript Web App
==========================================

Installs dependencies and sets up the NotebookLM MCP CLI integration.
"""

import subprocess
import sys
import os
from pathlib import Path

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"🔧 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed: {e.stderr}")
        return False

def check_python_version():
    """Check Python version"""
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 or higher is required")
        return False
    print(f"✅ Python {sys.version.split()[0]} detected")
    return True

def install_python_dependencies():
    """Install Python dependencies"""
    return run_command(
        f"{sys.executable} -m pip install -r requirements.txt",
        "Installing Python dependencies"
    )

def check_node_npm():
    """Check if Node.js and npm are available"""
    node_check = subprocess.run("node --version", shell=True, capture_output=True)
    npm_check = subprocess.run("npm --version", shell=True, capture_output=True)
    
    if node_check.returncode != 0:
        print("❌ Node.js not found. Please install Node.js from https://nodejs.org/")
        return False
    
    if npm_check.returncode != 0:
        print("❌ npm not found. Please install npm")
        return False
    
    print(f"✅ Node.js {node_check.stdout.decode().strip()} detected")
    print(f"✅ npm {npm_check.stdout.decode().strip()} detected")
    return True

def install_notebooklm_cli():
    """Install NotebookLM MCP CLI"""
    print("\n📚 Installing NotebookLM MCP CLI...")
    
    # Clone the repository
    if not os.path.exists("notebooklm-mcp-cli"):
        if not run_command(
            "git clone https://github.com/jacob-bd/notebooklm-mcp-cli.git",
            "Cloning NotebookLM MCP CLI repository"
        ):
            return False
    
    # Install dependencies
    original_dir = os.getcwd()
    try:
        os.chdir("notebooklm-mcp-cli")
        
        if not run_command("npm install", "Installing NotebookLM CLI dependencies"):
            return False
        
        if not run_command("npm link", "Creating global link for NotebookLM CLI"):
            print("⚠️  Global link failed, but local installation should work")
        
        os.chdir(original_dir)
        return True
        
    except Exception as e:
        print(f"❌ Error installing NotebookLM CLI: {e}")
        os.chdir(original_dir)
        return False

def create_directories():
    """Create necessary directories"""
    directories = [
        "outputs",
        "temp", 
        "static/downloads",
        "templates"
    ]
    
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"✅ Created directory: {directory}")
    
    return True

def create_config_file():
    """Create configuration file"""
    config_content = """# YouTube Transcript Web App Configuration
# =============================================

# Flask Settings
DEBUG = True
SECRET_KEY = 'your-secret-key-change-this-in-production'
HOST = '0.0.0.0'
PORT = 5000

# Processing Settings
MAX_VIDEOS_PER_REQUEST = 100
DEFAULT_MAX_VIDEOS = 25
REQUEST_DELAY = 2.0
MAX_RETRIES = 3

# Output Settings
DEFAULT_OUTPUT_FORMAT = 'both'  # 'txt', 'md', or 'both'
INCLUDE_TIMESTAMPS = True
INCLUDE_METADATA = True

# NotebookLM Settings
NOTEBOOKLM_ENABLED = True
NOTEBOOKLM_TIMEOUT = 60
NOTEBOOKLM_CLI_PATH = 'notebooklm-mcp-cli'

# File Management
CLEANUP_TEMP_FILES = True
MAX_FILE_AGE_HOURS = 24
MAX_STORAGE_MB = 1000
"""
    
    with open("config.py", "w") as f:
        f.write(config_content)
    
    print("✅ Created configuration file: config.py")
    return True

def test_installation():
    """Test the installation"""
    print("\n🧪 Testing installation...")
    
    # Test Python imports
    try:
        import flask
        import flask_socketio
        import youtube_transcript_api
        import yt_dlp
        import requests
        import bs4
        print("✅ All Python dependencies imported successfully")
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    
    # Test NotebookLM CLI
    result = subprocess.run("node notebooklm-mcp-cli/index.js --help", 
                          shell=True, capture_output=True)
    if result.returncode == 0:
        print("✅ NotebookLM MCP CLI is working")
    else:
        print("⚠️  NotebookLM MCP CLI test failed (but app will still work)")
    
    return True

def main():
    """Main setup function"""
    print("🚀 YouTube Transcript Web App Setup")
    print("=" * 50)
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Install Python dependencies
    if not install_python_dependencies():
        print("\n❌ Setup failed during Python dependency installation")
        sys.exit(1)
    
    # Check Node.js/npm
    if not check_node_npm():
        print("\n⚠️  Node.js/npm not found. NotebookLM integration will be disabled.")
        print("   You can still use the transcript extraction features.")
        notebooklm_available = False
    else:
        notebooklm_available = True
    
    # Install NotebookLM CLI if Node.js is available
    if notebooklm_available:
        if not install_notebooklm_cli():
            print("\n⚠️  NotebookLM CLI installation failed. Integration will be disabled.")
    
    # Create directories
    if not create_directories():
        print("\n❌ Setup failed during directory creation")
        sys.exit(1)
    
    # Create config file
    if not create_config_file():
        print("\n❌ Setup failed during config creation")
        sys.exit(1)
    
    # Test installation
    if not test_installation():
        print("\n⚠️  Some tests failed, but basic functionality should work")
    
    print("\n" + "=" * 60)
    print("✅ SETUP COMPLETE!")
    print("=" * 60)
    print("\n🎯 Next Steps:")
    print("1. Run the web app: python app.py")
    print("2. Open your browser: http://localhost:5000")
    print("3. Enter a YouTube channel URL and start extracting!")
    
    if notebooklm_available:
        print("\n📚 NotebookLM Integration:")
        print("- Transcripts can be automatically sent to NotebookLM")
        print("- Make sure you have NotebookLM access configured")
    else:
        print("\n📚 NotebookLM Integration:")
        print("- Install Node.js to enable NotebookLM integration")
        print("- Or manually upload the downloaded transcripts")
    
    print("\n🎬 Ready to extract YouTube transcripts!")

if __name__ == "__main__":
    main()