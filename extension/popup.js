// Global functions for transcript operations
function downloadTranscript(index) {
  chrome.runtime.sendMessage({
    type: "download_transcript_at_index",
    index: index
  });
}

function viewTranscript(index) {
  chrome.storage.local.get(['meetings'], (result) => {
    const meetings = result.meetings || [];
    const meeting = meetings[index];
    
    if (meeting) {
      const transcriptWindow = window.open('', '_blank');
      transcriptWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Meeting Transcript</title>
          <style>
            body {
              font-family: 'Inter', sans-serif;
              line-height: 1.6;
              max-width: 1200px;
              margin: 2rem auto;
              padding: 0 1rem;
              color: #1f2937;
            }
            .container {
              display: grid;
              grid-template-columns: 2fr 1fr;
              gap: 2rem;
            }
            .transcript-section {
              background: #ffffff;
              padding: 1.5rem;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
            }
            .qa-section {
              background: #ffffff;
              padding: 1.5rem;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
            }
            pre {
              white-space: pre-wrap;
              background: #f9fafb;
              padding: 1rem;
              border-radius: 0.5rem;
              border: 1px solid #e5e7eb;
              max-height: 600px;
              overflow-y: auto;
            }
            .header {
              margin-bottom: 2rem;
            }
            .date {
              color: #6b7280;
              font-size: 0.9rem;
            }
            .question-input {
              width: 100%;
              padding: 0.75rem;
              border: 1px solid #e5e7eb;
              border-radius: 6px;
              margin-bottom: 1rem;
              font-family: inherit;
            }
            .ask-button {
              background: #1f2937;
              color: #ffffff;
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: 500;
              width: 100%;
            }
            .ask-button:hover {
              background: #111827;
            }
            .answer {
              margin-top: 1rem;
              padding: 1rem;
              background: #f9fafb;
              border-radius: 6px;
              border: 1px solid #e5e7eb;
            }
            .answer.hidden {
              display: none;
            }
            .chat-section {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 1px solid #e5e7eb;
            }
            .transcript-block {
              margin-bottom: 1rem;
              padding: 0.5rem;
              background: #f9fafb;
              border-radius: 4px;
            }
            .speaker {
              font-weight: 500;
              color: #1f2937;
            }
            .timestamp {
              color: #6b7280;
              font-size: 0.85rem;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${meeting.title || 'Meeting Transcript'}</h1>
            <div class="date">${new Date(meeting.meetingEndTimestamp).toLocaleString()}</div>
          </div>
          <div class="container">
            <div class="transcript-section">
              <h2>Transcript</h2>
              <div id="transcript-content">
                ${formatTranscript(meeting.transcript)}
              </div>
              <div class="chat-section">
                <h2>Chat Messages</h2>
                <div id="chat-content">
                  ${formatChat(meeting.chatMessages)}
                </div>
              </div>
            </div>
            <div class="qa-section">
              <h2>Ask Questions</h2>
              <input type="text" class="question-input" placeholder="Ask a question about the transcript..." id="questionInput">
              <button class="ask-button" onclick="askQuestion()">Ask Question</button>
              <div class="answer hidden" id="answer"></div>
            </div>
          </div>
          <script>
            function formatTranscript(transcript) {
              if (!transcript || !Array.isArray(transcript)) return '';
              return transcript.map(block => \`
                <div class="transcript-block">
                  <div class="speaker">\${block.personName}</div>
                  <div class="timestamp">\${new Date(block.timestamp).toLocaleString()}</div>
                  <div>\${block.transcriptText || block.personTranscript}</div>
                </div>
              \`).join('');
            }

            function formatChat(chat) {
              if (!chat || !Array.isArray(chat)) return '';
              return chat.map(block => \`
                <div class="transcript-block">
                  <div class="speaker">\${block.personName}</div>
                  <div class="timestamp">\${new Date(block.timestamp).toLocaleString()}</div>
                  <div>\${block.chatMessageText}</div>
                </div>
              \`).join('');
            }

            function askQuestion() {
              const question = document.getElementById('questionInput').value;
              const answerDiv = document.getElementById('answer');
              const transcriptBlocks = ${JSON.stringify(meeting.transcript)};
              
              // Simple keyword-based answer generation
              const keywords = question.toLowerCase().split(' ');
              let relevantBlocks = transcriptBlocks.filter(block => 
                keywords.some(keyword => 
                  (block.transcriptText || block.personTranscript).toLowerCase().includes(keyword)
                )
              );
              
              if (relevantBlocks.length > 0) {
                const answers = relevantBlocks.map(block => 
                  \`\${block.personName}: \${block.transcriptText || block.personTranscript}\`
                );
                answerDiv.innerHTML = answers.join('<br><br>');
                answerDiv.classList.remove('hidden');
              } else {
                answerDiv.textContent = "I couldn't find a specific answer to your question in the transcript.";
                answerDiv.classList.remove('hidden');
              }
            }
          </script>
        </body>
        </html>
      `);
      transcriptWindow.document.close();
    }
  });
}

// Initialize popup
window.onload = function () {
  const autoModeRadio = document.getElementById('auto-mode');
  const manualModeRadio = document.getElementById('manual-mode');
  const transcriptList = document.getElementById('transcript-list');
  const versionElement = document.getElementById('version');

  document.querySelector("#version").innerHTML = `v${chrome.runtime.getManifest().version}`

  chrome.storage.sync.get(['mode'], (result) => {
    if (result.mode === 'auto') {
      autoModeRadio.checked = true;
    } else if (result.mode === 'manual') {
      manualModeRadio.checked = true;
    }
  });

  autoModeRadio.addEventListener('change', () => {
    if (autoModeRadio.checked) {
      chrome.storage.sync.set({ mode: 'auto' });
    }
  });
  manualModeRadio.addEventListener('change', () => {
    if (manualModeRadio.checked) {
      chrome.storage.sync.set({ mode: 'manual' });
    }
  });

  // Load and display transcript history
  function loadTranscriptHistory() {
    chrome.storage.local.get(['meetings'], (result) => {
      const meetings = result.meetings || [];
      
      if (meetings.length === 0) {
        transcriptList.innerHTML = `
          <div class="transcript-item" style="justify-content: center; color: #6b7280;">
            No transcripts available yet
          </div>
        `;
        return;
      }

      transcriptList.innerHTML = meetings
        .sort((a, b) => new Date(b.meetingEndTimestamp) - new Date(a.meetingEndTimestamp))
        .slice(0, 5) // Show only the 5 most recent transcripts
        .map((meeting, index) => `
          <div class="transcript-item">
            <div class="transcript-info">
              <div class="transcript-title">${meeting.title || 'Untitled Meeting'}</div>
              <div class="transcript-date">${new Date(meeting.meetingEndTimestamp).toLocaleString()}</div>
            </div>
            <div class="transcript-actions">
              <button class="btn btn-primary" onclick="downloadTranscript(${index})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </button>
              <button class="btn btn-secondary" onclick="viewTranscript(${index})">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                View
              </button>
            </div>
          </div>
        `)
        .join('');
    });
  }

  // Load transcript history when popup opens
  document.addEventListener('DOMContentLoaded', () => {
    loadTranscriptHistory();
    versionElement.textContent = chrome.runtime.getManifest().version;
  });
}