// Add this at the very top of the file
if (window.hasTranscriptProContentScript) {
    console.log("Transcript Pro content script already running, skipping initialization");
    return;
}
window.hasTranscriptProContentScript = true;

// Attempt to recover last meeting, if any. Abort if it takes more than 1 second to prevent current meeting getting messed up.
Promise.race([
  recoverLastMeeting(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Recovery timed out')), 1000)
  )
]).
  catch((error) => {
    console.log(error)
  }).
  finally(() => {
    // Save current meeting data to chrome storage once recovery is complete or is aborted
    overWriteChromeStorage(["meetingStartTimestamp", "meetingTitle", "transcript", "chatMessages"], false)
  })

//*********** GLOBAL VARIABLES **********//
const timeFormat = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
}
const extensionStatusJSON_bug = {
  "status": 400,
  "message": `<strong>Meeting Transcript Pro encountered a new error</strong> <br /> Please report it <a href="https://github.com/Anvita004/transcriptpro/issues" target="_blank">here</a>.`
}
const reportErrorMessage = "There is a bug in Meeting Transcript Pro. Please report it at https://github.com/Anvita004/transcriptpro/issues"
const mutationConfig = { childList: true, attributes: true, subtree: true, characterData: true }

// Name of the person attending the meeting
let userName = "You"
// Transcript array that holds one or more transcript blocks
// Each transcript block (object) has personName, timestamp and transcriptText key value pairs
let transcript = []
// Buffer variables to dump values, which get pushed to transcript array as transcript blocks, at defined conditions
let personNameBuffer = "", transcriptTextBuffer = "", timestampBuffer = undefined
// Buffer variables for deciding when to push a transcript block
let beforePersonName = "", beforeTranscriptText = ""
// Chat messages array that holds one or chat messages of the meeting
// Each message block(object) has personName, timestamp and messageText key value pairs
let chatMessages = []

// Capture meeting start timestamp, stored in UNIX format
let meetingStartTimestamp = Date.now()
let meetingTitle = document.title
// Capture invalid transcript and chat messages DOM element error for the first time
let isTranscriptDomErrorCaptured = false
let isChatMessagesDomErrorCaptured = false
// Capture meeting begin to abort userName capturing interval
let hasMeetingStarted = false
// Capture meeting end to suppress any errors
let hasMeetingEnded = false

let extensionStatusJSON = {
  status: 200,
  message: "<strong>Transcript capture started</strong> <br /> The transcript will be automatically downloaded when the meeting ends."
}

let canUseAriaBasedTranscriptSelector = true

let transcriptObserver = null;
let chatMessagesObserver = null;

let isExtensionActive = true;

//*********** MAIN FUNCTIONS **********//
checkExtensionStatus().then(() => {
  // Read the status JSON
  chrome.storage.local.get(["extensionStatusJSON", "isActive"], function (result) {
    extensionStatusJSON = result.extensionStatusJSON || extensionStatusJSON
    isExtensionActive = result.isActive !== false; // Default to true if not set
    console.log("Extension status " + extensionStatusJSON.status + ", Active: " + isExtensionActive)

    // If extension is not active, ensure all operations are stopped
    if (!isExtensionActive) {
      stopAllOperations()
      return
    }

    // Only start if extension is active and status is 200
    if (extensionStatusJSON.status == 200) {
      // Check if observers are already running
      if (transcriptObserver || chatMessagesObserver) {
        console.log("Observers already running, skipping initialization")
        return
      }
      meetingRoutines(2)
    } else {
      // Show downtime message as extension status is 400
      showNotification(extensionStatusJSON)
      stopAllOperations()
    }
  })
})

function meetingRoutines(uiType) {
  if (!isExtensionActive) {
    console.log("Extension is not active, skipping meeting routines")
    return
  }

  const meetingEndIconData = {
    selector: "",
    text: ""
  }
  const captionsIconData = {
    selector: "",
    text: ""
  }
  // Different selector data for different UI versions
  switch (uiType) {
    case 1:
      meetingEndIconData.selector = ".google-material-icons"
      meetingEndIconData.text = "call_end"
      captionsIconData.selector = ".material-icons-extended"
      captionsIconData.text = "closed_caption_off"
      break
    case 2:
      meetingEndIconData.selector = ".google-symbols"
      meetingEndIconData.text = "call_end"
      captionsIconData.selector = ".google-symbols"
      captionsIconData.text = "closed_caption_off"
    default:
      break
  }

  // CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
  waitForElement(meetingEndIconData.selector, meetingEndIconData.text).then(() => {
    console.log("Meeting started")
    chrome.runtime.sendMessage({ type: "new_meeting_started" }, function (response) {
      console.log(response)
    })
    hasMeetingStarted = true

    //*********** MEETING START ROUTINES **********//
    // Pick up meeting name after a delay, since Google meet updates meeting name after a delay
    setTimeout(() => updateMeetingTitle(), 5000)

    // **** REGISTER TRANSCRIPT LISTENER **** //
    try {
      // CRITICAL DOM DEPENDENCY
      const captionsButton = selectElements(captionsIconData.selector, captionsIconData.text)[0]

      // Click captions icon for non manual operation modes. Async operation.
      chrome.storage.sync.get(["operationMode"], function (result) {
        if (result.operationMode == "manual")
          console.log("Manual mode selected, leaving transcript off")
        else
          captionsButton.click()
      })

      // Allow captions to switch on. An attempt to reduce errors of missing transcript nodes.
      // CRITICAL DOM DEPENDENCY. Grab the transcript element. This element is present, irrespective of captions ON/OFF, so this executes independent of operation mode.
      let transcriptTargetNode = document.querySelector(`div[role="region"][tabindex="0"]`)
      // For old captions UI
      if (!transcriptTargetNode) {
        transcriptTargetNode = document.querySelector(".a4cQT")
        canUseAriaBasedTranscriptSelector = false
      }

      // Attempt to dim down the transcript
      canUseAriaBasedTranscriptSelector
        ? transcriptTargetNode.setAttribute("style", "opacity:0.2")
        : transcriptTargetNode.childNodes[1].setAttribute("style", "opacity:0.2")

      // Create transcript observer instance linked to the callback function
      transcriptObserver = new MutationObserver(transcriptMutationCallback)

      // Start observing the transcript element
      transcriptObserver.observe(transcriptTargetNode, mutationConfig)
    } catch (err) {
      console.error(err)
      isTranscriptDomErrorCaptured = true
      showNotification(extensionStatusJSON_bug)
      logError("001", err)
    }

    // **** REGISTER CHAT MESSAGES LISTENER **** //
    try {
      const chatMessagesButton = selectElements(".google-symbols", "chat")[0]
      // Force open chat messages to make the required DOM to appear
      chatMessagesButton.click()

      // Allow DOM to be updated and then register chatMessage mutation observer
      waitForElement(`div[aria-live="polite"].Ge9Kpc`).then(() => {
        chatMessagesButton.click()
        try {
          const chatMessagesTargetNode = document.querySelector(`div[aria-live="polite"].Ge9Kpc`)
          chatMessagesObserver = new MutationObserver(chatMessagesMutationCallback)
          chatMessagesObserver.observe(chatMessagesTargetNode, mutationConfig)
        } catch (err) {
          console.error(err)
          showNotification(extensionStatusJSON_bug)
          logError("002", err)
        }
      })
    } catch (err) {
      console.error(err)
      isChatMessagesDomErrorCaptured = true
      showNotification(extensionStatusJSON_bug)
      logError("003", err)
    }

    // Show confirmation message based on operation mode
    if (!isTranscriptDomErrorCaptured && !isChatMessagesDomErrorCaptured) {
      chrome.storage.sync.get(["operationMode"], function (result) {
        if (result.operationMode == "manual") {
          showNotification({ status: 400, message: "<strong>Transcript capture is not running</strong> <br /> Turn on captions using the CC icon, if needed" })
        }
        else {
          showNotification(extensionStatusJSON)
        }
      })
    }

    //*********** MEETING END ROUTINES **********//
    try {
      // CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
      selectElements(meetingEndIconData.selector, meetingEndIconData.text)[0].parentElement.parentElement.addEventListener("click", () => {
        // To suppress further errors
        hasMeetingEnded = true
        if (transcriptObserver) {
          transcriptObserver.disconnect()
        }
        if (chatMessagesObserver) {
          chatMessagesObserver.disconnect()
        }

        // Push any data in the buffer variables to the transcript array, but avoid pushing blank ones. Needed to handle one or more speaking when meeting ends.
        if ((personNameBuffer != "") && (transcriptTextBuffer != ""))
          pushBufferToTranscript()
        // Save to chrome storage and send message to download transcript from background script
        overWriteChromeStorage(["transcript", "chatMessages"], true)
      })
    } catch (err) {
      console.error(err)
      showNotification(extensionStatusJSON_bug)

      logError("004", err)
    }
  }
}

//*********** CALLBACK FUNCTIONS **********//
// Function to handle transcript mutations
function transcriptMutationCallback(mutations) {
  if (!isExtensionActive) {
    console.log("Extension is not active, skipping transcript capture")
    return
  }
    try {
        // Get the transcript container
        const transcriptContainer = document.querySelector(`div[role="region"][tabindex="0"]`) || document.querySelector(".a4cQT");
        if (!transcriptContainer) {
            console.log("Transcript container not found");
            return;
        }

        // Get all transcript blocks
        const transcriptBlocks = transcriptContainer.querySelectorAll('.nMcdL');
        let hasNewTranscript = false;

        transcriptBlocks.forEach(block => {
            const speakerElement = block.querySelector('.KcIKyf');
            const textElement = block.querySelector('.bh44bd');

            if (speakerElement && textElement) {
                const speaker = speakerElement.textContent.trim();
                const text = textElement.textContent.trim();
                const timestamp = Date.now();

                // Add to transcript array if not already present
                if (!transcript.some(t => t.personName === speaker && t.transcriptText === text)) {
                    transcript.push({
                        personName: speaker,
                        transcriptText: text,
                        timestamp: timestamp
                    });
                    hasNewTranscript = true;
                }
            }
        });

        // Only save to storage if we have new transcript content
        if (hasNewTranscript) {
            chrome.storage.local.set({ transcript: transcript }, function() {
                console.log("Transcript saved to storage:", transcript.length, "entries");
            });
        }
    } catch (error) {
        console.error("Error in transcript mutation callback:", error);
        if (!isTranscriptDomErrorCaptured) {
            isTranscriptDomErrorCaptured = true;
            showNotification(extensionStatusJSON_bug);
        }
    }
}

// Function to handle chat message mutations
function chatMessagesMutationCallback(mutations) {
  if (!isExtensionActive) {
    console.log("Extension is not active, skipping chat message capture")
    return
  }
    try {
        // Get the chat container
        const chatContainer = document.querySelector(`div[aria-live="polite"].Ge9Kpc`);
        if (!chatContainer) {
            console.log("Chat container not found");
            return;
        }

        // Get all chat message elements
        const messageElements = chatContainer.querySelectorAll('.QTyiie');
        let hasNewMessages = false;

        messageElements.forEach(message => {
            const senderElement = message.querySelector('.poVWob');
            const textElement = message.querySelector('div[jscontroller="RrV5Ic"]');
            
            if (senderElement && textElement) {
                const sender = senderElement.textContent.trim();
                const text = textElement.textContent.trim();
                const timestamp = Date.now();

                // Add to chat messages array if not already present
                if (!chatMessages.some(m => m.personName === sender && m.chatMessageText === text)) {
                    chatMessages.push({
                        personName: sender,
                        chatMessageText: text,
                        timestamp: timestamp
                    });
                    hasNewMessages = true;
                }
            }
        });

        // Only save to storage if we have new messages
        if (hasNewMessages) {
            chrome.storage.local.set({ chatMessages: chatMessages }, function() {
                console.log("Chat messages saved to storage:", chatMessages.length, "entries");
            });
        }
    } catch (error) {
        console.error("Error in chat messages mutation callback:", error);
        if (!isChatMessagesDomErrorCaptured) {
            isChatMessagesDomErrorCaptured = true;
            showNotification(extensionStatusJSON_bug);
        }
    }
}

// Function to save data to chrome storage
function overWriteChromeStorage(keys, isMeetingEnd) {
    const data = {};
    
    keys.forEach(key => {
        switch(key) {
            case "transcript":
                data.transcript = transcript;
                break;
            case "chatMessages":
                data.chatMessages = chatMessages;
                break;
            case "meetingStartTimestamp":
                data.meetingStartTimestamp = meetingStartTimestamp;
                break;
            case "meetingTitle":
                data.meetingTitle = meetingTitle;
                break;
        }
    });
    
    chrome.storage.local.set(data, function() {
        console.log("Data saved to storage:", keys);
        
        if (isMeetingEnd) {
            // Ensure all data is saved before sending the meeting ended message
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: "meeting_ended" }, function(response) {
                    console.log("Meeting ended message sent:", response);
                });
            }, 1000);
        }
    });
}

//*********** HELPER FUNCTIONS **********//
function checkExtensionStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["extensionStatusJSON"], function (result) {
      if (!result.extensionStatusJSON) {
        chrome.storage.local.set({ extensionStatusJSON: extensionStatusJSON }, function () {
          console.log("Extension status set to 200")
          resolve()
        })
      }
      else {
        resolve()
      }
    })
  })
}

function waitForElement(selector, text) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      if (text) {
        const elements = selectElements(selector, text)
        if (elements.length > 0) {
          resolve(elements[0])
        }
        else {
          const interval = setInterval(() => {
            const elements = selectElements(selector, text)
            if (elements.length > 0) {
              clearInterval(interval)
              resolve(elements[0])
            }
          }, 100)
        }
      }
      else {
        resolve(document.querySelector(selector))
      }
    }
    else {
      const interval = setInterval(() => {
        if (document.querySelector(selector)) {
          clearInterval(interval)
          if (text) {
            const elements = selectElements(selector, text)
            if (elements.length > 0) {
              resolve(elements[0])
            }
          }
          else {
            resolve(document.querySelector(selector))
          }
        }
      }, 100)
    }
  })
}

function selectElements(selector, text) {
  const elements = document.querySelectorAll(selector)
  return Array.from(elements).filter(element => element.textContent.trim() === text)
}

function pushBufferToTranscript() {
  if (personNameBuffer && transcriptTextBuffer && timestampBuffer) {
  transcript.push({
      personName: personNameBuffer,
      transcriptText: transcriptTextBuffer,
      timestamp: timestampBuffer
    })

    // Clear buffers
    personNameBuffer = ""
    transcriptTextBuffer = ""
    timestampBuffer = undefined

    // Save to chrome storage
  overWriteChromeStorage(["transcript"], false)
  }
}

function updateMeetingTitle() {
  meetingTitle = document.title
    overWriteChromeStorage(["meetingTitle"], false)
}

function showNotification(extensionStatusJSON) {
  const notification = document.createElement("div")
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 10px;
    background-color: ${extensionStatusJSON.status == 200 ? "#4CAF50" : "#f44336"};
    color: white;
    border-radius: 4px;
    z-index: 9999;
    max-width: 300px;
    font-family: Arial, sans-serif;
  `
  notification.innerHTML = extensionStatusJSON.message
  document.body.appendChild(notification)

  setTimeout(() => {
    notification.remove()
  }, 5000)
}

function logError(errorCode, error) {
  console.error(`Error ${errorCode}:`, error)
  // You can add error reporting logic here
}

function recoverLastMeeting() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["transcript", "chatMessages"], function (result) {
      if (result.transcript && result.transcript.length > 0) {
        transcript = result.transcript
        chatMessages = result.chatMessages || []
        chrome.runtime.sendMessage({ type: "recover_last_meeting" }, function (response) {
          console.log(response)
                resolve()
            })
          }
          else {
              resolve()
      }
    })
  })
}

// Function to stop all operations
function stopAllOperations() {
    console.log("Stopping all operations");
    isExtensionActive = false;
    
    // Disconnect and nullify observers
    if (transcriptObserver) {
        transcriptObserver.disconnect();
        transcriptObserver = null;
    }
    if (chatMessagesObserver) {
        chatMessagesObserver.disconnect();
        chatMessagesObserver = null;
    }
    
    // Clear all data
    transcript = [];
    chatMessages = [];
    
    // Clear storage
    chrome.storage.local.set({ 
        transcript: [], 
        chatMessages: [],
        isActive: false 
    }, function() {
        console.log("All operations stopped and data cleared");
    });
}

// Function to start all operations
function startAllOperations() {
    console.log("Starting all operations");
    
    // If observers are already running, don't start again
    if (transcriptObserver || chatMessagesObserver) {
        console.log("Observers already running, skipping start");
        return;
    }
    
    isExtensionActive = true;
    chrome.storage.local.set({ isActive: true }, function() {
        meetingRoutines(2);
    });
}

// Listen for extension state changes
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && changes.isActive) {
        console.log("Extension active state changed to:", changes.isActive.newValue);
        if (!changes.isActive.newValue) {
            stopAllOperations();
        } else {
            startAllOperations();
        }
    }
});