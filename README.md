# 🎬 YouTube Transcript Web App

**A modern web application for extracting transcripts from YouTube channels and integrating with NotebookLM.**

![Web App Preview](https://img.shields.io/badge/Status-Ready-brightgreen) ![Python](https://img.shields.io/badge/Python-3.8+-blue) ![Flask](https://img.shields.io/badge/Flask-2.3+-red) ![NotebookLM](https://img.shields.io/badge/NotebookLM-Integrated-purple)

## 🚀 Features

### 🎯 **Core Functionality**
- **Channel Analysis**: Automatically discover videos from any YouTube channel
- **Batch Processing**: Extract transcripts from multiple videos simultaneously
- **Multiple Formats**: Output in Text, Markdown, or both formats
- **Progress Tracking**: Real-time progress updates with WebSocket integration
- **Smart Selection**: Select all, top videos, or most recent videos

### 📚 **NotebookLM Integration**
- **Automatic Upload**: Send extracted transcripts directly to NotebookLM
- **MCP CLI Integration**: Uses the official NotebookLM MCP CLI
- **Batch Processing**: Combines all transcripts for comprehensive analysis
- **Error Handling**: Graceful fallback if NotebookLM is unavailable

### 🎨 **Modern Web Interface**
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Real-time Updates**: Live progress tracking with WebSocket
- **Intuitive UI**: Step-by-step workflow with visual feedback
- **Professional Styling**: Clean, modern interface with smooth animations

## 📦 Quick Start

### 1. **Setup** (5 minutes)
```bash
cd youtube_transcript_webapp
python setup.py
```

### 2. **Run the App**
```bash
python app.py
```

### 3. **Open Browser**
Navigate to: `http://localhost:5000`

### 4. **Extract Transcripts**
1. Enter YouTube channel URL
2. Select videos to process
3. Choose output format
4. Click "Extract Transcripts"
5. Download results or view in NotebookLM

## 🛠️ Installation

### Prerequisites
- **Python 3.8+** (required)
- **Node.js 16+** (optional, for NotebookLM integration)
- **Git** (for NotebookLM CLI installation)

### Automated Setup
```bash
git clone <repository>
cd youtube_transcript_webapp
python setup.py
```

### Manual Setup
```bash
# Install Python dependencies
pip install -r requirements.txt

# Install NotebookLM CLI (optional)
git clone https://github.com/jacob-bd/notebooklm-mcp-cli.git
cd notebooklm-mcp-cli
npm install
npm link

# Create directories
mkdir -p outputs temp static/downloads templates
```

## 🎯 Usage Guide

### **Step 1: Channel Input**
- Enter any YouTube channel URL:
  - `https://www.youtube.com/@channelname`
  - `https://www.youtube.com/channel/CHANNEL_ID`
  - `https://www.youtube.com/c/channelname`
- Set maximum videos (10-100)
- Choose output format (Text, Markdown, or both)
- Enable/disable NotebookLM integration

### **Step 2: Video Selection**
- **Auto-discovery**: App finds all videos in the channel
- **Smart Selection**: 
  - Select All: Process all discovered videos
  - Top 10: Select highest-performing videos
  - Most Recent: Select newest videos
  - Manual: Click individual videos to select
- **Visual Preview**: See thumbnails, titles, and metadata

### **Step 3: Processing**
- **Real-time Progress**: Watch extraction progress live
- **Error Handling**: Automatic retry with fallback methods
- **Quality Control**: Validates transcript content
- **Background Processing**: Continue using the app while processing

### **Step 4: Results**
- **Download Options**: 
  - Individual transcript files
  - Complete ZIP archive
  - Organized by video ID
- **NotebookLM Integration**: 
  - Automatic upload if enabled
  - Combined transcript for comprehensive analysis
  - Error reporting with troubleshooting

## 🔧 Configuration

### **App Settings** (`config.py`)
```python
# Server Configuration
DEBUG = True
HOST = '0.0.0.0'
PORT = 5000

# Processing Limits
MAX_VIDEOS_PER_REQUEST = 100
DEFAULT_MAX_VIDEOS = 25
REQUEST_DELAY = 2.0

# Output Options
DEFAULT_OUTPUT_FORMAT = 'both'
INCLUDE_TIMESTAMPS = True
INCLUDE_METADATA = True

# NotebookLM Settings
NOTEBOOKLM_ENABLED = True
NOTEBOOKLM_TIMEOUT = 60
```

### **Environment Variables**
```bash
export FLASK_ENV=development
export FLASK_DEBUG=1
export NOTEBOOKLM_API_KEY=your_key_here  # If required
```

## 🎨 Web Interface

### **Modern Design Features**
- **Gradient Backgrounds**: Beautiful color schemes
- **Card-based Layout**: Clean video selection interface
- **Progress Animations**: Smooth progress bars and transitions
- **Responsive Grid**: Adapts to any screen size
- **Interactive Elements**: Hover effects and visual feedback

### **User Experience**
- **Step-by-step Workflow**: Clear progression through the process
- **Real-time Feedback**: Instant updates on processing status
- **Error Handling**: User-friendly error messages
- **Accessibility**: Keyboard navigation and screen reader support

## 🔌 API Endpoints

### **Channel Analysis**
```http
POST /api/analyze_channel
Content-Type: application/json

{
  "channel_url": "https://www.youtube.com/@channelname",
  "max_videos": 25
}
```

### **Transcript Extraction**
```http
POST /api/extract_transcripts
Content-Type: application/json

{
  "video_urls": ["https://www.youtube.com/watch?v=VIDEO_ID"],
  "format": "both",
  "notebooklm": true
}
```

### **Job Status**
```http
GET /api/job_status/{job_id}
```

### **File Download**
```http
GET /download/{filename}
```

## 📚 NotebookLM Integration

### **Setup Requirements**
1. **Install Node.js**: Download from [nodejs.org](https://nodejs.org/)
2. **Clone MCP CLI**: Automatically done by setup script
3. **Configure Access**: Follow NotebookLM CLI setup instructions

### **How It Works**
1. **Transcript Combination**: All selected transcripts are combined
2. **Automatic Upload**: Uses NotebookLM MCP CLI to upload content
3. **Error Handling**: Graceful fallback if upload fails
4. **Status Reporting**: Real-time feedback on upload progress

### **Manual Integration**
If automatic integration fails:
1. Download the ZIP file with all transcripts
2. Extract the files
3. Manually upload to NotebookLM
4. Or use the CLI directly: `notebooklm-mcp-cli upload transcript.txt`

## 🔍 Troubleshooting

### **Common Issues**

#### **"No videos found"**
- **Cause**: Channel URL format or privacy settings
- **Solution**: Try different URL format or check if channel is public

#### **"Transcript extraction failed"**
- **Cause**: Video doesn't have captions or is private
- **Solution**: App automatically tries multiple extraction methods

#### **"NotebookLM upload failed"**
- **Cause**: CLI not installed or configured
- **Solution**: Check Node.js installation and run setup again

#### **"Connection timeout"**
- **Cause**: Network issues or rate limiting
- **Solution**: Reduce batch size and increase delays

### **Debug Mode**
```bash
export FLASK_DEBUG=1
python app.py
```

### **Log Files**
- **App Logs**: Check console output
- **Processing Logs**: `outputs/{job_id}/processing.log`
- **Error Logs**: `temp/errors.log`

## 🚀 Performance Optimization

### **Recommended Settings**
- **Small Channels** (<50 videos): Process all at once
- **Large Channels** (>50 videos): Process in batches of 25
- **Rate Limiting**: 2-3 second delay between requests
- **Concurrent Processing**: Disabled to avoid rate limits

### **System Requirements**
- **RAM**: 2GB minimum, 4GB recommended
- **Storage**: 1GB free space for temporary files
- **Network**: Stable internet connection
- **CPU**: Any modern processor (not CPU intensive)

## 🔒 Privacy & Security

### **Data Handling**
- **Temporary Storage**: Files deleted after 24 hours
- **No User Data**: No personal information collected
- **Local Processing**: All processing done on your machine
- **Secure Downloads**: Files served over HTTPS in production

### **YouTube Compliance**
- **Rate Limiting**: Respects YouTube's API limits
- **Terms of Service**: Compliant with YouTube ToS
- **Fair Use**: For educational and research purposes
- **No Redistribution**: Transcripts for personal use only

## 🛣️ Roadmap

### **Planned Features**
- [ ] **Playlist Support**: Extract from YouTube playlists
- [ ] **Advanced Filtering**: Filter by date, duration, views
- [ ] **Batch Channels**: Process multiple channels at once
- [ ] **API Keys**: Support for YouTube Data API
- [ ] **Cloud Storage**: Integration with Google Drive, Dropbox
- [ ] **AI Analysis**: Automatic topic extraction and summarization

### **Technical Improvements**
- [ ] **Database Storage**: Persistent job storage
- [ ] **User Accounts**: Save preferences and history
- [ ] **Docker Support**: Containerized deployment
- [ ] **Kubernetes**: Scalable cloud deployment
- [ ] **REST API**: Full API for programmatic access

## 📄 License

This project is open source and available under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

- **Issues**: Report bugs on GitHub Issues
- **Documentation**: Check this README and inline comments
- **Community**: Join discussions in GitHub Discussions

---

**Built with ❤️ for the YouTube creator community**

**Ready to extract transcripts and supercharge your NotebookLM analysis!** 🚀