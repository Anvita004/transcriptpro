# TranscriptPro

A Chrome extension for capturing and managing Google Meet transcripts.

## Features

- Real-time transcript capture from Google Meet
- Automatic transcript download when meeting ends
- Webhook integration for transcript delivery
- Transcript summarization using Gemini AI
- Q&A functionality for transcript analysis
- Clean and modern user interface

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `extension` directory from this repository

## Usage

1. Join a Google Meet call
2. Click the extension icon to start capturing the transcript
3. The transcript will be automatically downloaded when the meeting ends
4. Use the popup interface to:
   - View current transcript
   - Generate summaries
   - Ask questions about the transcript
   - Configure webhook settings

## Configuration

### Webhook Setup

1. Click the extension icon
2. Go to the Webhooks tab
3. Enter your webhook URL
4. Choose the payload format (Simple or Advanced)
5. Save your settings

## Support

For support, please open an issue in this repository.

## Privacy

This extension only captures transcripts from meetings you are actively participating in. All processing is done locally in your browser.
