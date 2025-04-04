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
                <div class="summary-section" id="summary-${meeting.id}">
                    <div class="loading">Generating summary...</div>
                </div>
                <div class="qa-section" id="qa-${meeting.id}">
                    <div class="qa-options">
                        <div class="qa-option active" data-type="keyword">Keyword Search</div>
                        <div class="qa-option" data-type="ai">AI Search</div>
                    </div>
                    <div class="qa-input">
                        <input type="text" placeholder="Ask a question..." class="qa-input-field">
                        <button class="button qa-search-btn">Search</button>
                    </div>
                    <div class="qa-results"></div>
                </div>
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

        transcriptList.querySelectorAll('.qa-option').forEach(option => {
            option.addEventListener('click', () => {
                const qaSection = option.closest('.qa-section');
                qaSection.querySelectorAll('.qa-option').forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
            });
        });

        transcriptList.querySelectorAll('.qa-search-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const qaSection = btn.closest('.qa-section');
                const meetingId = qaSection.id.replace('qa-', '');
                const input = qaSection.querySelector('.qa-input-field');
                const searchType = qaSection.querySelector('.qa-option.active').dataset.type;
                searchTranscript(meetingId, input.value, searchType);
            });
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
    qaSection.style.display = qaSection.style.display === 'none' ? 'block' : 'none';
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

        // Sort transcript by timestamp
        const sortedTranscript = [...transcript].sort((a, b) => a.timestamp - b.timestamp);

        // Group messages by speaker and time window
        const messageGroups = [];
        let currentGroup = null;

        sortedTranscript.forEach(block => {
            const text = block.transcriptText || block.personTranscript;
            if (!text) return;

            // If no current group or speaker changed, start new group
            if (!currentGroup || block.personName !== currentGroup.personName) {
                if (currentGroup && currentGroup.messages.length > 0) {
                    messageGroups.push(currentGroup);
                }
                currentGroup = {
                    personName: block.personName,
                    startTime: block.timestamp,
                    messages: []
                };
            }

            // Only add message if it's different from the last message in the group
            if (currentGroup.messages.length === 0 || 
                text !== currentGroup.messages[currentGroup.messages.length - 1]) {
                currentGroup.messages.push(text);
            }
        });

        // Add the last group
        if (currentGroup && currentGroup.messages.length > 0) {
            messageGroups.push(currentGroup);
        }

        // Open in a new window
        const transcriptWindow = window.open('', '_blank');
        transcriptWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${meeting.title}</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        margin: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .transcript-block {
                        margin-bottom: 20px;
                    }
                    .chat-block {
                        margin-bottom: 20px;
                        padding: 10px;
                        background-color: #f5f5f5;
                    }
                    .timestamp {
                        color: #666;
                        font-size: 0.9em;
                    }
                    .person-name {
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    .chat-section {
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #ccc;
                    }
                </style>
            </head>
            <body>
                <h1>${meeting.title}</h1>
                <p>Meeting date: ${new Date(meeting.meetingStartTimestamp).toLocaleString()}</p>
                
                <h2>Transcript</h2>
                ${messageGroups.map(group => `
                    <div class="transcript-block">
                        <div class="person-name">${group.personName}</div>
                        <div class="timestamp">${new Date(group.startTime).toLocaleString("default", timeFormat).toUpperCase()}</div>
                        <div class="transcript-text">${group.messages[group.messages.length - 1].trim()}</div>
                    </div>
                `).join('')}
                <div class="chat-section">
                    <h2>Chat Messages</h2>
                    ${chatMessages.map(message => `
                        <div class="chat-block">
                            <div class="person-name">${message.personName}</div>
                            <div class="timestamp">${new Date(message.timestamp).toLocaleString("default", timeFormat).toUpperCase()}</div>
                            <div class="chat-text">${message.chatMessageText}</div>
                        </div>
                    `).join('')}
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
            await downloadTranscript(meeting.id);
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

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.getElementById('transcript-list').prepend(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

/*function getTranscriptString(transcript) {
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
}*/

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