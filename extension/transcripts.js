// Add timeFormat constant at the top of the file
const timeFormat = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
};

// Load transcripts when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Set up event listeners
        document.getElementById('refreshButton').addEventListener('click', refreshTranscripts);
        document.getElementById('downloadAllButton').addEventListener('click', downloadAllTranscripts);
        
        // Load initial transcripts
        await loadTranscripts();
    } catch (error) {
        console.error('Error loading transcripts:', error);
        showError('Failed to load transcripts. Please try refreshing the page.');
    }
});

// Function to load transcripts from chrome.storage.local
async function loadTranscripts() {
    try {
        // Get all items from storage
        const storage = await chrome.storage.local.get(null);
        
        // Filter and format meeting data
        const meetings = Object.entries(storage)
            .filter(([key, value]) => key.startsWith('meeting_'))
            .map(([key, value]) => value);

        const transcriptList = document.getElementById('transcript-list');

        if (!meetings || meetings.length === 0) {
            transcriptList.innerHTML = '<div class="empty-state">No transcripts available. Join a Google Meet meeting to start recording.</div>';
            return;
        }

        // Sort meetings by end timestamp (newest first)
        meetings.sort((a, b) => b.meetingEndTimestamp - a.meetingEndTimestamp);

        // Generate HTML for each transcript
        const transcriptHTML = meetings.map(meeting => `
            <div class="transcript-item">
                <div class="transcript-info">
                    <div class="transcript-title">${meeting.title}</div>
                    <div class="transcript-date">${new Date(meeting.meetingEndTimestamp).toLocaleString()}</div>
                    <div class="transcript-stats">
                        <span>${meeting.transcriptLength} transcript entries</span>
                        <span>${meeting.chatMessagesLength} chat messages</span>
                    </div>
                </div>
                <div class="transcript-actions">
                    <button class="button download-btn" data-id="${meeting.id}">Download</button>
                    <button class="button view-btn" data-id="${meeting.id}">View</button>
                    <button class="button summary-btn" data-id="${meeting.id}">Summarize</button>
                    <button class="button qa-btn" data-id="${meeting.id}">Q&A</button>
                </div>
                <div class="summary-section" id="summary-${meeting.id}" style="display: none;"></div>
                <div class="qa-section" id="qa-${meeting.id}" style="display: none;"></div>
            </div>
        `).join('');

        transcriptList.innerHTML = transcriptHTML;

        // Add event listeners to buttons
        transcriptList.querySelectorAll('.download-btn').forEach(btn => {
            btn.addEventListener('click', () => downloadTranscript(btn.dataset.id));
        });

        transcriptList.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => viewTranscript(btn.dataset.id));
        });

        transcriptList.querySelectorAll('.summary-btn').forEach(btn => {
            btn.addEventListener('click', () => generateSummary(btn.dataset.id));
        });

        transcriptList.querySelectorAll('.qa-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleQASection(btn.dataset.id));
        });
    } catch (error) {
        console.error('Error loading transcripts:', error);
        showError('Failed to load transcripts. Please try refreshing the page.');
    }
}

// Function to generate summary
async function generateSummary(meetingId) {
    try {
        const summarySection = document.getElementById(`summary-${meetingId}`);
        summarySection.style.display = 'block';
        summarySection.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Generating AI summary... This may take a few moments.</p>
            </div>
        `;
        
        // Get transcript data
        const [transcriptData, chatData] = await Promise.all([
            chrome.storage.local.get(`transcript_${meetingId}`),
            chrome.storage.local.get(`chat_${meetingId}`)
        ]);

        const transcript = transcriptData[`transcript_${meetingId}`] || [];
        const chatMessages = chatData[`chat_${meetingId}`] || [];

        // Combine transcript and chat messages
        const fullText = getTranscriptString(transcript) + '\n\n' + getChatMessagesString(chatMessages);

        // Send to background script for AI processing
        chrome.runtime.sendMessage({
            type: 'generate_summary',
            text: fullText
        }, response => {
            if (response.success) {
                summarySection.innerHTML = `
                    <div class="summary-container">
                        <h3>AI-Generated Summary</h3>
                        <div class="summary-content">
                            <p>${response.summary}</p>
                        </div>
                        <div class="summary-meta">
                            <span class="timestamp">Generated on ${new Date().toLocaleString()}</span>
                        </div>
                    </div>
                `;
            } else {
                summarySection.innerHTML = `
                    <div class="error-message">
                        <p>Failed to generate summary: ${response.error}</p>
                        <button class="retry-button" onclick="generateSummary('${meetingId}')">Retry</button>
                    </div>
                `;
            }
        });
    } catch (error) {
        console.error('Error generating summary:', error);
        showError('Failed to generate summary. Please try again.');
    }
}

// Function to toggle Q&A section
function toggleQASection(meetingId) {
    const qaSection = document.getElementById(`qa-${meetingId}`);
    if (qaSection.style.display === 'none') {
        qaSection.style.display = 'block';
        qaSection.innerHTML = `
            <div class="qa-container">
                <div class="qa-input-container">
                    <input type="text" placeholder="Ask anything about this meeting..." class="qa-input-field">
                    <button class="button qa-search-btn">
                        <span class="search-icon">🔍</span>
                        Search
                    </button>
                </div>
                <div class="qa-results"></div>
            </div>
        `;

        qaSection.querySelector('.qa-search-btn').addEventListener('click', () => {
            const input = qaSection.querySelector('.qa-input-field');
            searchTranscript(meetingId, input.value, 'ai');
        });

        // Add enter key support
        qaSection.querySelector('.qa-input-field').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const input = qaSection.querySelector('.qa-input-field');
                searchTranscript(meetingId, input.value, 'ai');
            }
        });
    } else {
        qaSection.style.display = 'none';
    }
}

// Function to search transcript
async function searchTranscript(meetingId, query, searchType) {
    try {
        const qaSection = document.getElementById(`qa-${meetingId}`);
        const resultsDiv = qaSection.querySelector('.qa-results');
        resultsDiv.innerHTML = '<div class="loading">Searching...</div>';

        // Get transcript data
        const [transcriptData, chatData] = await Promise.all([
            chrome.storage.local.get(`transcript_${meetingId}`),
            chrome.storage.local.get(`chat_${meetingId}`)
        ]);

        const transcript = transcriptData[`transcript_${meetingId}`] || [];
        const chatMessages = chatData[`chat_${meetingId}`] || [];

        // Send to background script for processing
        chrome.runtime.sendMessage({
            type: 'search_transcript',
            meetingId: meetingId,
            query: query,
            searchType: searchType,
            transcript: transcript,
            chatMessages: chatMessages
        }, response => {
            if (response.success) {
                resultsDiv.innerHTML = response.results.map(result => `
                    <div class="qa-result">
                        <strong>Q:</strong> ${result.question}<br>
                        <strong>A:</strong> ${result.answer}
                    </div>
                `).join('');
            } else {
                resultsDiv.innerHTML = `<div class="error-message">Search failed: ${response.error}</div>`;
            }
        });
    } catch (error) {
        console.error('Error searching transcript:', error);
        showError('Failed to search transcript. Please try again.');
    }
}

// Function to download transcript
async function downloadTranscript(id) {
    try {
        await chrome.runtime.sendMessage({ type: 'download_transcript_at_index', index: id });
    } catch (error) {
        console.error('Error downloading transcript:', error);
        showError('Failed to download transcript. Please try again.');
    }
}

// Function to view transcript
async function viewTranscript(id) {
    try {
        const [meetingData, transcriptData, chatData] = await Promise.all([
            chrome.storage.local.get(`meeting_${id}`),
            chrome.storage.local.get(`transcript_${id}`),
            chrome.storage.local.get(`chat_${id}`)
        ]);

        const meeting = meetingData[`meeting_${id}`];
        if (!meeting) {
            throw new Error("Meeting not found");
        }

        const transcript = transcriptData[`transcript_${id}`] || [];
        const chatMessages = chatData[`chat_${id}`] || [];

        // Group messages by speaker and time window
        const messageGroups = [];
        let currentGroup = {
            personName: transcript[0]?.personName,
            startTime: transcript[0]?.timestamp,
            messages: []
        };

        transcript.forEach(block => {
            const text = block.transcriptText || block.personTranscript;
            if (!text) return;

            // If speaker changes or time gap is more than 10 seconds, start new group
            if (block.personName !== currentGroup.personName || 
                block.timestamp - currentGroup.startTime > 10000) {
                if (currentGroup.messages.length > 0) {
                    messageGroups.push(currentGroup);
                }
                currentGroup = {
                    personName: block.personName,
                    startTime: block.timestamp,
                    messages: []
                };
            }
            currentGroup.messages.push(text);
        });

        // Add the last group
        if (currentGroup.messages.length > 0) {
            messageGroups.push(currentGroup);
        }

        // Create a new window to display the transcript
        const transcriptWindow = window.open('', '_blank');
        transcriptWindow.document.write(`
            <html>
            <head>
                <title>${meeting.title} - Transcript</title>
                <style>
                    body {
                        font-family: 'Inter', Arial, sans-serif;
                        margin: 0;
                        padding: 0;
                        background: linear-gradient(135deg, #1a1a1a 0%, #2a1a3a 100%);
                        color: #ffffff;
                        min-height: 100vh;
                    }
                    .container {
                        max-width: 1200px;
                        margin: 0 auto;
                        padding: 40px;
                    }
                    .header {
                        background: rgba(30, 30, 30, 0.8);
                        padding: 30px;
                        border-radius: 12px;
                        margin-bottom: 30px;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        backdrop-filter: blur(10px);
                    }
                    h1 {
                        margin: 0;
                        font-size: 28px;
                        background: linear-gradient(90deg, #9d4edd, #c77dff);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                    }
                    .meeting-info {
                        margin-top: 15px;
                        color: #b3b3b3;
                        font-size: 0.9em;
                    }
                    .content-section {
                        background: rgba(30, 30, 30, 0.8);
                        padding: 30px;
                        border-radius: 12px;
                        margin-bottom: 30px;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                        backdrop-filter: blur(10px);
                    }
                    h2 {
                        margin: 0 0 20px 0;
                        font-size: 24px;
                        color: #ffffff;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                        padding-bottom: 10px;
                    }
                    .transcript-entry {
                        margin-bottom: 15px;
                        padding: 15px;
                        background: rgba(40, 40, 40, 0.6);
                        border-radius: 8px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        transition: all 0.3s ease;
                    }
                    .transcript-entry:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
                        border-color: rgba(157, 78, 221, 0.3);
                    }
                    .speaker {
                        color: #9d4edd;
                        font-weight: 600;
                        margin-bottom: 5px;
                    }
                    .timestamp {
                        color: #b3b3b3;
                        font-size: 0.8em;
                        margin-bottom: 5px;
                    }
                    .message {
                        color: #ffffff;
                        line-height: 1.5;
                    }
                    .chat-message {
                        margin-bottom: 15px;
                        padding: 15px;
                        background: rgba(40, 40, 40, 0.6);
                        border-radius: 8px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        transition: all 0.3s ease;
                    }
                    .chat-message:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
                        border-color: rgba(157, 78, 221, 0.3);
                    }
                    .chat-sender {
                        color: #9d4edd;
                        font-weight: 600;
                        margin-bottom: 5px;
                    }
                    .chat-time {
                        color: #b3b3b3;
                        font-size: 0.8em;
                        margin-bottom: 5px;
                    }
                    .chat-content {
                        color: #ffffff;
                        line-height: 1.5;
                    }
                    .empty-state {
                        text-align: center;
                        color: #b3b3b3;
                        padding: 40px 20px;
                        font-size: 1.1em;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>${meeting.title}</h1>
                        <div class="meeting-info">
                            Meeting date: ${new Date(meeting.meetingEndTimestamp).toLocaleString()}
                        </div>
                    </div>
                    
                    <div class="content-section">
                        <h2>Transcript</h2>
                        ${messageGroups.length > 0 ? messageGroups.map(group => `
                            <div class="transcript-entry">
                                <div class="speaker">${group.personName || 'Unknown Speaker'}</div>
                                <div class="timestamp">${new Date(group.startTime).toLocaleString()}</div>
                                <div class="message">${group.messages[group.messages.length - 1].trim()}</div>
                            </div>
                        `).join('') : '<div class="empty-state">No transcript available</div>'}
                    </div>

                    <div class="content-section">
                        <h2>Chat Messages</h2>
                        ${chatMessages.length > 0 ? chatMessages.map(msg => {
                            const text = msg.chatMessageText || '';
                            return `
                                <div class="chat-message">
                                    <div class="chat-sender">${msg.personName || 'Unknown Sender'}</div>
                                    <div class="chat-time">${new Date(msg.timestamp).toLocaleString()}</div>
                                    <div class="chat-content">${text}</div>
                                </div>
                            `;
                        }).join('') : '<div class="empty-state">No chat messages available</div>'}
                    </div>
                </div>
            </body>
            </html>
        `);
        transcriptWindow.document.close();
    } catch (error) {
        console.error('Error viewing transcript:', error);
        showError('Failed to view transcript. Please try again.');
    }
}

// Function to download all transcripts
async function downloadAllTranscripts() {
    try {
        const storage = await chrome.storage.local.get(null);
        const meetings = Object.entries(storage)
            .filter(([key, value]) => key.startsWith('meeting_'))
            .map(([key, value]) => value);

        for (const meeting of meetings) {
            await chrome.runtime.sendMessage({ type: 'download_transcript_at_index', index: meeting.id });
        }
    } catch (error) {
        console.error('Error downloading all transcripts:', error);
        showError('Failed to download all transcripts. Please try again.');
    }
}

// Function to refresh transcripts
async function refreshTranscripts() {
    try {
        await loadTranscripts();
    } catch (error) {
        console.error('Error refreshing transcripts:', error);
        showError('Failed to refresh transcripts. Please try again.');
    }
}

// Function to show error message
function showError(message) {
    const transcriptList = document.getElementById('transcript-list');
    transcriptList.innerHTML = `
        <div class="error-message">
            ${message}
        </div>
    `;
}

function getTranscriptString(transcript) {
    let transcriptString = "";
    if (transcript && transcript.length > 0) {
        // Get the last version of each unique text
        const uniqueTexts = new Map();
        transcript.forEach(block => {
            const text = block.transcriptText || block.personTranscript;
            if (text) {
                uniqueTexts.set(text, block);
            }
        });

        // Combine the final versions into a single paragraph
        transcriptString = Array.from(uniqueTexts.values())
            .map(block => block.transcriptText || block.personTranscript)
            .join(" ")
            .trim();
    }
    return transcriptString;
}

function getChatMessagesString(chatMessages) {
    let chatMessagesString = "";
    if (chatMessages.length > 0) {
        chatMessages.forEach(chatBlock => {
            chatMessagesString += `${chatBlock.personName} (${new Date(chatBlock.timestamp).toLocaleString("default", timeFormat).toUpperCase()})\n`;
            chatMessagesString += chatBlock.chatMessageText;
            chatMessagesString += "\n\n";
        });
    }
    return chatMessagesString;
} 