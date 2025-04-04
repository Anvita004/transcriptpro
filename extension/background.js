const timeFormat = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.log(message.type)

    if (message.type == "new_meeting_started") {
        // Saving current tab id, to download transcript when this tab is closed
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tabId = tabs[0].id
            chrome.storage.local.set({ meetingTabId: tabId }, function () {
                console.log("Meeting tab id saved")
            })
        })
    }

    if (message.type == "meeting_ended") {
        downloadAndPostWebhook().finally(() => {
            // Invalidate tab id since transcript is downloaded, prevents double downloading of transcript from tab closed event listener
            clearTabIdAndApplyUpdate()
        })
    }

    if (message.type == "download_transcript_at_index") {
        // Download the requested item
        downloadTranscript(message.index, false).then(() => {
            sendResponse({ success: true })
        })
    }

    if (message.type == "retry_webhook_at_index") {
        // Handle webhook retry
        postTranscriptToWebhook(message.index)
            .then(() => {
                sendResponse({ success: true })
            })
            .catch(error => {
                console.error("Webhook retry failed:", error)
                sendResponse({ success: false, error: error.message })
            })
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
        chrome.storage.local.get(["transcript", "chatMessages", "meetingStartTimestamp", "meetingTitle"], function (data) {
            if (!data.transcript || data.transcript.length === 0) {
                reject(new Error("No transcript data available"))
                return
            }

            const transcriptString = getTranscriptString(data.transcript)
            const chatMessagesString = getChatMessagesString(data.chatMessages)
            const meetingDate = new Date(data.meetingStartTimestamp).toLocaleDateString("en-US", timeFormat)

            resolve({
                transcript: transcriptString,
                chatMessages: chatMessagesString,
                meetingDate: meetingDate,
                meetingTitle: data.meetingTitle
            })
        })
    })
}

// Function to download transcript and post to webhook
async function downloadAndPostWebhook() {
    try {
        const { transcript, chatMessages, meetingDate, meetingTitle } = await processTranscript()
        
        // Download transcript
        await downloadTranscript(null, true)
        
        // Post to webhook if configured
        chrome.storage.sync.get(["webhookUrl", "webhookBodyType"], function (data) {
            if (data.webhookUrl) {
                postTranscriptToWebhook(null, data.webhookUrl, data.webhookBodyType)
                    .catch(error => {
                        console.error("Webhook post failed:", error)
                    })
            }
        })
    } catch (error) {
        console.error("Download and webhook process failed:", error)
        throw error
    }
}

// Function to download transcript
async function downloadTranscript(id) {
    try {
        const { transcript, chatMessages, meetingDate, meetingTitle } = await processTranscript()
        
        const fileName = `${meetingTitle} - ${meetingDate}.txt`
        const fileContent = `Meeting: ${meetingTitle}\nDate: ${meetingDate}\n\nTranscript:\n${transcript}\n\nChat Messages:\n${chatMessages}`
        
        const blob = new Blob([fileContent], { type: "text/plain" })
        const url = URL.createObjectURL(blob)
        
        chrome.downloads.download({
            url: url,
            filename: fileName,
            saveAs: false
        })
    } catch (error) {
        console.error("Download failed:", error)
        throw error
    }
}

// Function to post transcript to webhook
async function postTranscriptToWebhook(meetingId, url, bodyType) {
    try {
        const { transcript, chatMessages, meetingDate, meetingTitle } = await processTranscript()
        
        const payload = {
            meetingTitle: meetingTitle,
            meetingDate: meetingDate,
            transcript: transcript,
            chatMessages: chatMessages
        }
        
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        })
        
        if (!response.ok) {
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`)
        }
    } catch (error) {
        console.error("Webhook post failed:", error)
        throw error
    }
}

// Function to get transcript string
function getTranscriptString(transcript) {
    return transcript.map(block => {
        const timestamp = new Date(block.timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        })
        return `[${timestamp}] ${block.personName}: ${block.transcriptText}`
    }).join("\n")
}

// Function to get chat messages string
function getChatMessagesString(chatMessages) {
    if (!chatMessages || chatMessages.length === 0) {
        return "No chat messages"
    }
    return chatMessages.map(message => {
        const timestamp = new Date(message.timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        })
        return `[${timestamp}] ${message.personName}: ${message.messageText}`
    }).join("\n")
}

// Function to clear tab ID and apply update
function clearTabIdAndApplyUpdate() {
    chrome.storage.local.remove(["meetingTabId"], function () {
        console.log("Meeting tab id cleared")
    })
}

// Function to preprocess transcript
function preprocessTranscript(text) {
    // Remove timestamps
    text = text.replace(/\[\d{2}:\d{2} [AP]M\]/g, "")
    
    // Remove speaker names
    text = text.replace(/[A-Za-z]+:/g, "")
    
    // Remove extra whitespace
    text = text.replace(/\s+/g, " ").trim()
    
    return text
}

// Function to generate summary using Gemini API
async function generateSummary(text) {
    try {
        console.log('Starting summary generation with Gemini...')
        
        // Preprocess the transcript
        const cleanedText = preprocessTranscript(text)
        console.log('Cleaned text length:', cleanedText.length)
        
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
        )

        console.log('API Response status:', response.status)
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        console.log('API Response data:', data)
        
        if (!data || !data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
            throw new Error('Invalid API response format')
        }
        
        return data.candidates[0].content.parts[0].text
    } catch (error) {
        console.error("Error generating summary:", error)
        throw error
    }
}

// Function to search transcript using Gemini API
async function searchTranscript(query, searchType, transcript, chatMessages) {
    try {
        let results = []
        
        // Get the final version of each unique text
        const uniqueTexts = new Map()
        transcript.forEach(block => {
            const text = block.transcriptText || block.personTranscript
            if (text) {
                uniqueTexts.set(text, block)
            }
        })

        // Convert to array of final texts
        const finalTranscripts = Array.from(uniqueTexts.values())
            .map(block => block.transcriptText || block.personTranscript)

        // Combine all transcript text
        const fullTranscript = finalTranscripts.join('\n\n')

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
        )

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        
        if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) {
            results.push({
                question: query,
                answer: data.candidates[0].content.parts[0].text
            })
        }

        return results
    } catch (error) {
        console.error("Error searching transcript:", error)
        throw error
    }
}