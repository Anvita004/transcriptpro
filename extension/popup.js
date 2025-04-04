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
document.addEventListener('DOMContentLoaded', function() {
    const autoMode = document.getElementById('auto-mode');
    const manualMode = document.getElementById('manual-mode');
    const toggleBtn = document.getElementById('toggleBtn');
    const autoRadio = document.getElementById('auto-radio');
    const manualRadio = document.getElementById('manual-radio');
    const modeStatus = document.getElementById('modeStatus');
    const githubBtn = document.getElementById('githubBtn');
    const transcriptLink = document.getElementById('transcriptLink');
    const versionElement = document.getElementById('version');

    // Set version if element exists
    if (versionElement) {
        versionElement.textContent = `v${chrome.runtime.getManifest().version}`;
    }

    // Function to update UI based on extension state
    function updateExtensionState(isActive) {
        console.log('Updating extension state:', isActive);
        
        // Update toggle button
        if (isActive) {
            toggleBtn.innerHTML = '<span>⏹️</span>Stop';
            toggleBtn.style.background = 'linear-gradient(135deg, #f87171 0%, #ef4444 100%)';
        } else {
            toggleBtn.innerHTML = '<span>▶️</span>Start';
            toggleBtn.style.background = 'linear-gradient(135deg, #9d4edd 0%, #c77dff 100%)';
        }

        // Update other elements
        if (isActive) {
            // Enable all elements
            autoMode.classList.remove('disabled');
            manualMode.classList.remove('disabled');
            githubBtn.classList.remove('disabled');
            transcriptLink.classList.remove('disabled');
            autoRadio.disabled = false;
            manualRadio.disabled = false;
        } else {
            // Disable all elements
            autoMode.classList.add('disabled');
            manualMode.classList.add('disabled');
            githubBtn.classList.add('disabled');
            transcriptLink.classList.add('disabled');
            autoRadio.disabled = true;
            manualRadio.disabled = true;
        }
    }

    // Function to update mode UI
    function updateModeUI(mode) {
        console.log('=== updateModeUI called with mode:', mode);
        if (mode === 'auto') {
            console.log('Setting UI to auto mode');
            autoRadio.checked = true;
            manualRadio.checked = false;
            autoMode.classList.add('selected');
            manualMode.classList.remove('selected');
            modeStatus.textContent = 'Current Mode: Auto';
            modeStatus.className = 'mode-status auto';
        } else {
            console.log('Setting UI to manual mode');
            manualRadio.checked = true;
            autoRadio.checked = false;
            manualMode.classList.add('selected');
            autoMode.classList.remove('selected');
            modeStatus.textContent = 'Current Mode: Manual';
            modeStatus.className = 'mode-status manual';
        }
    }

    // Load saved state
    chrome.storage.local.get(['isActive'], function(result) {
        const isActive = result.isActive || false;
        updateExtensionState(isActive);
        
        // Load mode after setting extension state
        chrome.storage.sync.get(['operationMode'], function(result) {
            console.log('=== Loading saved state:', result);
            const mode = result.operationMode || 'auto';
            console.log('Setting initial mode to:', mode);
            updateModeUI(mode);
        });
    });

    // Mode selection handlers
    autoMode.addEventListener('click', function() {
        if (toggleBtn.innerHTML.includes('Start')) return; // Don't allow mode change if extension is off
        console.log('=== Auto mode clicked');
        chrome.storage.sync.set({ operationMode: 'auto' }, function() {
            console.log('Storage updated to auto mode');
            updateModeUI('auto');
        });
    });

    manualMode.addEventListener('click', function() {
        if (toggleBtn.innerHTML.includes('Start')) return; // Don't allow mode change if extension is off
        console.log('=== Manual mode clicked');
        chrome.storage.sync.set({ operationMode: 'manual' }, function() {
            console.log('Storage updated to manual mode');
            updateModeUI('manual');
        });
    });

    // Radio button change handlers
    autoRadio.addEventListener('change', function() {
        if (toggleBtn.innerHTML.includes('Start')) return; // Don't allow mode change if extension is off
        console.log('=== Auto radio changed, checked:', autoRadio.checked);
        if (autoRadio.checked) {
            chrome.storage.sync.set({ operationMode: 'auto' }, function() {
                console.log('Storage updated to auto mode from radio');
                updateModeUI('auto');
            });
        }
    });

    manualRadio.addEventListener('change', function() {
        if (toggleBtn.innerHTML.includes('Start')) return; // Don't allow mode change if extension is off
        console.log('=== Manual radio changed, checked:', manualRadio.checked);
        if (manualRadio.checked) {
            chrome.storage.sync.set({ operationMode: 'manual' }, function() {
                console.log('Storage updated to manual mode from radio');
                updateModeUI('manual');
            });
        }
    });

    // Toggle button handler
    toggleBtn.addEventListener('click', function() {
        chrome.storage.local.get(['isActive'], function(result) {
            const newState = !result.isActive;
            chrome.storage.local.set({ isActive: newState }, function() {
                updateExtensionState(newState);
                chrome.runtime.sendMessage({
                    action: newState ? 'start' : 'stop'
                });
            });
        });
    });

    // Load transcript history
    loadTranscriptHistory();
});

// Load and display transcript history
function loadTranscriptHistory() {
  chrome.storage.local.get(['meetings'], (result) => {
    const meetings = result.meetings || [];
    
    if (meetings.length === 0) {
      transcriptLink.innerHTML = `
        <div class="transcript-item" style="justify-content: center; color: #6b7280;">
          No transcripts available yet
        </div>
      `;
      return;
    }

    transcriptLink.innerHTML = meetings
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