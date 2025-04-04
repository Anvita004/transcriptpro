const timeFormat = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.log('Background received message:', message);

    if (message.type === "new_meeting_started") {
        // Saving current tab id, to download transcript when this tab is closed
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tabId = tabs[0].id;
            chrome.storage.local.set({ meetingTabId: tabId }, function () {
                console.log("Meeting tab id saved");
                sendResponse({ success: true });
            });
        });
        return true; // Keep the message channel open for the async response
    }

    if (message.type === "meeting_ended") {
        downloadAndPostWebhook().finally(() => {
            // Invalidate tab id since transcript is downloaded, prevents double downloading of transcript from tab closed event listener
            clearTabIdAndApplyUpdate();
            sendResponse({ success: true });
        });
        return true; // Keep the message channel open for the async response
    }

    if (message.type === "download_transcript_at_index") {
        // Download the requested item
        downloadTranscript(message.index, false).then(() => {
            sendResponse({ success: true });
        });
        return true; // Keep the message channel open for the async response
    }

    if (message.type === "retry_webhook_at_index") {
        // Handle webhook retry
        postTranscriptToWebhook(message.index)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error("Webhook retry failed:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for the async response
    }

    if (message.action === "start" || message.action === "stop") {
        // Handle start/stop actions without expecting a response
        console.log("Received start/stop action:", message.action);
        return false; // No need to keep the message channel open
    }

    if (message.type == "recover_last_meeting") {
        downloadAndPostWebhook().then(() => {
            sendResponse({ success: true })
        }).catch((error) => {
            // Fails if transcript is empty or webhook request fails
            console.error("Recovery process failed:", error)
            sendResponse({ success: false, error: error.message })
        })
    }

    if (message.type == "generate_summary") {
        generateSummary(message.text).then(summary => {
            sendResponse({ success: true, summary });
        }).catch(error => {
            console.error("Summary generation failed:", error);
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep the message channel open for async response
    }

    if (message.type == "search_transcript") {
        searchTranscript(message.query, message.searchType, message.transcript, message.chatMessages)
            .then(results => {
                sendResponse({ success: true, results });
            })
            .catch(error => {
                console.error("Transcript search failed:", error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }

    return true;
})

// Download transcript if meeting tab is closed
chrome.tabs.onRemoved.addListener(function (tabid) {
    chrome.storage.local.get(["meetingTabId"], function (data) {
        if (tabid == data.meetingTabId) {
            console.log("Successfully intercepted tab close")

            downloadAndPostWebhook().finally(() => {
                // Clearing meetingTabId to prevent misfires of onRemoved until next meeting actually starts
                clearTabIdAndApplyUpdate()
            })
        }
    })
})

// Listen for extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
    // Check if there is an active meeting
    chrome.storage.local.get(["meetingTabId"], function (data) {
        if (data.meetingTabId) {
            // If there is an active meeting, don't update yet
            return
        }
        // If no active meeting, update the extension
        chrome.runtime.reload()
    })
})

// Function to process transcript data
function processTranscript() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([
            "transcript",
            "chatMessages",
            "meetingTitle",
            "meetingStartTimestamp",
            // Old name of meetingStartTimestamp
            "meetingStartTimeStamp"
        ], function (result) {
            // Create new transcript entry
            const newMeetingEntry = {
                title: result.meetingTitle || "Google Meet call",
                // Backward compatible chrome storage variable. Old name "meetingStartTimeStamp". 
                meetingStartTimestamp: result.meetingStartTimestamp || result.meetingStartTimeStamp,
                meetingEndTimestamp: Date.now(),
                // Backward compatible chrome storage variable transcript. One of the keys is changed from "personTranscript" to "transcriptText"
                transcript: result.transcript,
                chatMessages: result.chatMessages,
                webhookPostStatus: "new"
            }

            // Get existing recent transcripts and update
            chrome.storage.local.get(["meetings"], function (storageData) {
                let meetings = storageData.meetings || []
                meetings.push(newMeetingEntry)

                // Keep only last 10 transcripts
                if (meetings.length > 10) {
                    meetings = meetings.slice(-10)
                }

                // Save updated recent transcripts
                chrome.storage.local.set({ meetings: meetings }, function () {
                    console.log("Meeting data updated")
                    resolve()
                })
            })
        })
    })
}

// Function to download transcript and post to webhook
async function downloadAndPostWebhook() {
    try {
        console.log('=== DOWNLOAD AND WEBHOOK START ===');
        
        // Get meeting data from local storage
        const [transcript, chatMessages, meetingTitle, meetingStartTimestamp, webhookEnabled, webhookUrl, webhookBodyType] = await Promise.all([
            chrome.storage.local.get('transcript'),
            chrome.storage.local.get('chatMessages'),
            chrome.storage.local.get('meetingTitle'),
            chrome.storage.local.get('meetingStartTimestamp'),
            chrome.storage.local.get('webhookEnabled'),
            chrome.storage.local.get('webhookUrl'),
            chrome.storage.local.get('webhookBodyType')
        ]);

        console.log('Retrieved data:', {
            transcriptLength: transcript.transcript?.length,
            chatMessagesLength: chatMessages.chatMessages?.length,
            meetingTitle: meetingTitle.meetingTitle,
            meetingStartTimestamp: meetingStartTimestamp.meetingStartTimestamp
        });

        // Only proceed if there's actual transcript or chat data
        if (!transcript.transcript?.length && !chatMessages.chatMessages?.length) {
            console.log('❌ No transcript or chat messages to process');
            throw new Error('No transcript or chat messages available to process');
        }

        // Generate a unique meeting ID
        const meetingId = Date.now().toString();
        console.log('✅ Generated meeting ID:', meetingId);

        // Store meeting data in chrome.storage.local
        const meetingData = {
            id: meetingId,
            title: meetingTitle.meetingTitle || "Google Meet call",
            meetingStartTimestamp: meetingStartTimestamp.meetingStartTimestamp || Date.now(),
            meetingEndTimestamp: Date.now(),
            transcriptLength: transcript.transcript?.length || 0,
            chatMessagesLength: chatMessages.chatMessages?.length || 0
        };

        // Save all data to chrome.storage.local
        await chrome.storage.local.set({
            [`meeting_${meetingId}`]: meetingData,
            [`transcript_${meetingId}`]: transcript.transcript || [],
            [`chat_${meetingId}`]: chatMessages.chatMessages || []
        });

        // Verify the data was saved correctly
        const [savedMeetingData, savedTranscriptData, savedChatData] = await Promise.all([
            chrome.storage.local.get(`meeting_${meetingId}`),
            chrome.storage.local.get(`transcript_${meetingId}`),
            chrome.storage.local.get(`chat_${meetingId}`)
        ]);

        if (!savedMeetingData[`meeting_${meetingId}`] || 
            !savedTranscriptData[`transcript_${meetingId}`] || 
            !savedChatData[`chat_${meetingId}`]) {
            throw new Error('Failed to save meeting data to storage');
        }

        // Download transcript
        await downloadTranscript(meetingId);

        // Post to webhook if enabled and URL is available
        if (webhookEnabled.webhookEnabled && webhookUrl.webhookUrl) {
            try {
                await postTranscriptToWebhook(meetingId, webhookUrl.webhookUrl, webhookBodyType.webhookBodyType || 'simple');
            } catch (webhookError) {
                console.error('❌ Webhook post failed:', webhookError);
                // Don't throw the error here, as we still want to clear the storage
            }
        }

        // Clear temporary storage
        await chrome.storage.local.remove(['transcript', 'chatMessages', 'meetingTitle', 'meetingStartTimestamp']);

        return meetingId;
    } catch (error) {
        console.error('❌ Error in downloadAndPostWebhook:', error);
        throw error;
    }
}

// Function to download transcript
async function downloadTranscript(id) {
    try {
        console.log('Downloading transcript for meeting ID:', id);
        
        // Get meeting data from chrome.storage.local
        const [meetingData, transcriptData, chatData] = await Promise.all([
            chrome.storage.local.get(`meeting_${id}`),
            chrome.storage.local.get(`transcript_${id}`),
            chrome.storage.local.get(`chat_${id}`)
        ]);

        const meeting = meetingData[`meeting_${id}`];
        if (!meeting) {
            throw new Error("Meeting not found");
        }

        // Sanitise meeting title to prevent invalid file name errors
        const invalidFilenameRegex = /[:?"*<>|~/\\\u{1}-\u{1f}\u{7f}\u{80}-\u{9f}\p{Cf}\p{Cn}]|^[.\u{0}\p{Zl}\p{Zp}\p{Zs}]|[.\u{0}\p{Zl}\p{Zp}\p{Zs}]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?=\.|$)/gui;
        const sanitisedMeetingTitle = meeting.title.replaceAll(invalidFilenameRegex, "_");

        // Format timestamp for human-readable filename
        const timestamp = new Date(meeting.meetingStartTimestamp);
        const formattedTimestamp = timestamp.toLocaleString("default", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).replace(/[\/:]/g, "-");

        const fileName = `Transcript-${sanitisedMeetingTitle} at ${formattedTimestamp}.txt`;

        // Format transcript and chatMessages content
        let content = getTranscriptString(transcriptData[`transcript_${id}`] || []);
        content += `\n\n---------------\nCHAT MESSAGES\n---------------\n\n`;
        content += getChatMessagesString(chatData[`chat_${id}`] || []);

        // Create a data URL for the content
        const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);

        // Create a download with Chrome Download API
        try {
            await chrome.downloads.download({
                url: dataUrl,
                filename: fileName,
                conflictAction: "uniquify"
            });
            console.log("Transcript downloaded");
        } catch (err) {
            console.error(err);
            // Fallback to simple filename if the original filename fails
            await chrome.downloads.download({
                url: dataUrl,
                filename: "Transcript.txt",
                conflictAction: "uniquify"
            });
            console.log("Invalid file name. Transcript downloaded with simple file name.");
        }
    } catch (error) {
        console.error("Error downloading transcript:", error);
        throw error;
    }
}

// Function to post transcript to webhook
async function postTranscriptToWebhook(meetingId, url, bodyType) {
    try {
        // Get meeting data from chrome.storage.local
        const [meetingData, transcriptData, chatData] = await Promise.all([
            chrome.storage.local.get(`meeting_${meetingId}`),
            chrome.storage.local.get(`transcript_${meetingId}`),
            chrome.storage.local.get(`chat_${meetingId}`)
        ]);

        const meeting = meetingData[`meeting_${meetingId}`];
        if (!meeting) {
            throw new Error("Meeting not found");
        }

        let webhookData;
        if (bodyType === "advanced") {
            webhookData = {
                meetingTitle: meeting.title,
                meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toISOString(),
                meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toISOString(),
                transcript: transcriptData[`transcript_${meetingId}`] || [],
                chatMessages: chatData[`chat_${meetingId}`] || []
            };
        } else {
            webhookData = {
                meetingTitle: meeting.title,
                meetingStartTimestamp: new Date(meeting.meetingStartTimestamp).toLocaleString("default", timeFormat).toUpperCase(),
                meetingEndTimestamp: new Date(meeting.meetingEndTimestamp).toLocaleString("default", timeFormat).toUpperCase(),
                transcript: getTranscriptString(transcriptData[`transcript_${meetingId}`] || []),
                chatMessages: getChatMessagesString(chatData[`chat_${meetingId}`] || [])
            };
        }

        console.log('Posting to webhook:', {
            url,
            bodyType,
            meetingId,
            dataSize: JSON.stringify(webhookData).length
        });

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(webhookData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        console.log('Webhook post successful');
    } catch (error) {
        console.error("Error posting to webhook:", error);
        throw error;
    }
}

// Function to get transcript string
function getTranscriptString(transcript) {
    if (!transcript || transcript.length === 0) return "";

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

    // Format the transcript string
    let transcriptString = "";
    messageGroups.forEach(group => {
        // Take only the last message from each group as it's the most complete version
        const finalMessage = group.messages[group.messages.length - 1];
        transcriptString += `${group.personName} (${new Date(group.startTime).toLocaleString("default", timeFormat).toUpperCase()})\n`;
        transcriptString += finalMessage.trim();
        transcriptString += "\n\n";
    });

    return transcriptString;
}

// Function to get chat messages string
function getChatMessagesString(chatMessages) {
    let chatMessagesString = "";
    if (chatMessages && chatMessages.length > 0) {
        // Sort chat messages by timestamp to maintain chronological order
        const sortedMessages = [...chatMessages].sort((a, b) => a.timestamp - b.timestamp);
        
        sortedMessages.forEach(block => {
            const text = block.chatMessageText;
            if (text) {
                chatMessagesString += `${block.personName} (${new Date(block.timestamp).toLocaleString("default", timeFormat).toUpperCase()})\n`;
                chatMessagesString += text;
                chatMessagesString += "\n\n";
            }
        });
    }
    return chatMessagesString;
}

// Function to clear tab ID and apply update
function clearTabIdAndApplyUpdate() {
    chrome.storage.local.set({ meetingTabId: null }, function () {
        console.log("Meeting tab id cleared for next meeting")

        // Check if there's a deferred update
        chrome.storage.local.get(["isDeferredUpdatedAvailable"], function (result) {
            if (result.isDeferredUpdatedAvailable) {
                console.log("Applying deferred update")
                chrome.storage.local.set({ isDeferredUpdatedAvailable: false }, function () {
                    chrome.runtime.reload()
                })
            }
        })
    })
}

// Function to preprocess transcript
function preprocessTranscript(text) {
    // Split into lines and clean each line
    const lines = text.split('\n');
    const cleanedLines = lines.map(line => {
        // Remove timestamps and speaker names
        line = line.replace(/^[^(]+\([^)]+\):\s*/, '');
        // Clean up the message
        line = line.trim()
            .replace(/\s+/g, ' ')
            .replace(/\.+/g, '.');
        return line;
    }).filter(line => line.length > 5); // Remove very short lines

    // Join lines with proper spacing
    let cleanedText = cleanedLines.join(' ');
    
    // Clean up punctuation and spacing
    cleanedText = cleanedText
        .replace(/\s+/g, ' ')
        .replace(/([.,!?])([^\s])/g, '$1 $2')
        .replace(/\s+([.,!?])/g, '$1')
        .trim();

    // If the text is too long, keep the most recent content
    const maxLength = 1024;
    if (cleanedText.length > maxLength) {
        const sentences = cleanedText.split(/[.!?]+/).filter(s => s.trim());
        let truncatedText = '';
        for (let i = sentences.length - 1; i >= 0; i--) {
            if ((truncatedText + sentences[i]).length <= maxLength) {
                truncatedText = sentences[i] + '. ' + truncatedText;
            } else {
                break;
            }
        }
        cleanedText = truncatedText.trim();
    }
    
    return cleanedText;
}

// Function to generate summary using Gemini API
async function generateSummary(text) {
    try {
        console.log('Starting summary generation with Gemini...');
        
        // Preprocess the transcript
        const cleanedText = preprocessTranscript(text);
        console.log('Cleaned text length:', cleanedText.length);
        
        // Use Google's Gemini API
        const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyDDljpMYKi8LyB_i4OzZs80-bsXh0OOAV0",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Please provide a clear and concise summary of this meeting transcript:\n\n${cleanedText}`
                        }]
                    }]
                })
            }
        );

        console.log('API Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('API Response data:', data);
        
        if (!data || !data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
            throw new Error('Invalid API response format');
        }
        
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Error generating summary:", error);
        throw error;
    }
}

// Function to search transcript using Gemini API
async function searchTranscript(query, searchType, transcript, chatMessages) {
    try {
        let results = [];
        
        // Get the final version of each unique text
        const uniqueTexts = new Map();
        transcript.forEach(block => {
            const text = block.transcriptText || block.personTranscript;
            if (text) {
                uniqueTexts.set(text, block);
            }
        });

        // Convert to array of final texts
        const finalTranscripts = Array.from(uniqueTexts.values())
            .map(block => block.transcriptText || block.personTranscript);

        // Combine all transcript text
        const fullTranscript = finalTranscripts.join('\n\n');

        // Use Gemini for Q&A
        const response = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyDDljpMYKi8LyB_i4OzZs80-bsXh0OOAV0",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Based on this meeting transcript, please answer the following question: "${query}"\n\nTranscript:\n${fullTranscript}`
                        }]
                    }]
                })
            }
        );

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) {
            results.push({
                question: query,
                answer: data.candidates[0].content.parts[0].text
            });
        }

        return results;
    } catch (error) {
        console.error("Error searching transcript:", error);
        throw error;
    }
}