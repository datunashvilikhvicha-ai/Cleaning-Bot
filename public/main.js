const widgetConfig = window.CLEANING_BOT_CONFIG || {};
const TENANT_ID = (widgetConfig.tenantId || 'neurox').toLowerCase();
const BOT_PUBLIC_TOKEN = widgetConfig.token || '';
const isNeuroxTenant = TENANT_ID === 'neurox';
const INITIAL_BOT_GREETING = isNeuroxTenant
  ? "Hey! I'm the Neuro X AI assistant. Curious about our tech, projects, or how we can help?"
  : 'Hi there! How can I help with your cleaning today?';

const chat = document.getElementById('chat');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const newChatBtn = document.getElementById('new-chat');
const statusBadge = document.getElementById('api-status');
const quickActions = Array.from(document.querySelectorAll('.action'));

const CLIENT_STORAGE_KEY = `tenant-client-id-${TENANT_ID}`;

let abortController = null;
let isStreaming = false;
let clientWatchdog = null;
let clientFallbackTriggered = false;
let tokenWarningShown = false;

function ensureClientId() {
  let cid = sessionStorage.getItem(CLIENT_STORAGE_KEY);
  if (!cid) {
    cid = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(CLIENT_STORAGE_KEY, cid);
  }
  return cid;
}

const clientId = ensureClientId();

function addMessage(role, text, extraClass = '') {
  const bubble = document.createElement('div');
  bubble.className = `msg ${role}${extraClass ? ` ${extraClass}` : ''}`;
  bubble.textContent = text;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function createTypingBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'msg bot typing';
  bubble.innerHTML = `
    <span class="typing-label">Assistant is typing</span>
    <span class="typing-dots" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
  `;
  chat.appendChild(bubble);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function addStatusChip() {}

function setStreamingState(active) {
  isStreaming = active;
  sendBtn.disabled = active;
  sendBtn.textContent = active ? 'Sending…' : 'Send';
  stopBtn.hidden = !active;
  stopBtn.disabled = !active;
  input.readOnly = active;
  quickActions.forEach((btn) => {
    btn.disabled = active;
  });
  if (newChatBtn) newChatBtn.disabled = active;
}

function startClientWatchdog(onTimeout) {
  clearClientWatchdog();
  clientWatchdog = setTimeout(onTimeout, 8000);
}

function clearClientWatchdog() {
  if (clientWatchdog) {
    clearTimeout(clientWatchdog);
    clientWatchdog = null;
  }
}

function splitEvents(buffer, onEvent) {
  let working = buffer.replace(/\r\n/g, '\n');
  let boundary;
  while ((boundary = working.indexOf('\n\n')) !== -1) {
    const raw = working.slice(0, boundary);
    working = working.slice(boundary + 2);
    if (!raw.trim()) continue;
    let event = 'message';
    let data = '';
    raw.split('\n').forEach((line) => {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      }
    });
    try {
      const payload = data ? JSON.parse(data) : {};
      if (typeof window.handleSSEDebug === 'function') {
        window.handleSSEDebug(event, payload);
      }
      onEvent(event, payload);
    } catch (error) {
      console.error('SSE parse error', error, raw);
    }
  }
  return working;
}

async function runJsonFallback(message, typingBubble) {
  if (clientFallbackTriggered) return null;
  clientFallbackTriggered = true;
  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stream-Mode': 'json',
        'X-Client-ID': clientId,
        'X-Tenant-ID': TENANT_ID,
        'X-Bot-Token': BOT_PUBLIC_TOKEN,
        'X-Public-Token': BOT_PUBLIC_TOKEN,
        Accept: 'application/json',
      },
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify({ message }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.details || payload?.error || `HTTP ${response.status}`;
      typingBubble.textContent = `Sorry, something went wrong: ${detail}`;
      return 'Recovered from slow connection';
    }
    const reply = (payload?.reply || '').trim();
    typingBubble.textContent = reply || 'All set. Anything else I can help with?';
    return 'Recovered from slow connection';
  } catch (error) {
    console.error('Client fallback failed', error);
    typingBubble.textContent = 'Network error. Please try again.';
    return 'Recovered from slow connection';
  }
}

async function sendMessage(text) {
  if (isStreaming) return;
  const message = text ?? input.value.trim();
  if (!message) return;
  if (!BOT_PUBLIC_TOKEN) {
    if (!tokenWarningShown) {
      addMessage('bot', 'Configuration error: missing BOT_PUBLIC_TOKEN.');
      tokenWarningShown = true;
    }
    return;
  }

  addMessage('user', message);
  input.value = '';
  input.focus();

  abortController = new AbortController();
  clientFallbackTriggered = false;
  setStreamingState(true);

  const typingBubble = createTypingBubble();
  let contentNode = null;
  let aggregated = '';
  let finished = false;

  const ensureContentNode = () => {
    if (!contentNode) {
      typingBubble.classList.remove('typing');
      typingBubble.innerHTML = '';
      contentNode = document.createElement('span');
      typingBubble.appendChild(contentNode);
    }
    return contentNode;
  };

  const appendToken = (token) => {
    const node = ensureContentNode();
    node.textContent += token;
  };

  const setText = (value) => {
    const node = ensureContentNode();
    node.textContent = value;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearClientWatchdog();
    setStreamingState(false);
    abortController = null;
    typingBubble.classList.remove('typing');
    input.focus();
  };

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Client-ID': clientId,
        'X-Tenant-ID': TENANT_ID,
        'X-Bot-Token': BOT_PUBLIC_TOKEN,
        'X-Public-Token': BOT_PUBLIC_TOKEN,
      },
      body: JSON.stringify({ message }),
      credentials: 'include',
      mode: 'cors',
      signal: abortController.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload?.details || payload?.error || `HTTP ${response.status}`;
      setText(`Sorry, something went wrong: ${detail}`);
      finish();
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload?.reply || payload?.details || 'No reply received.';
      setText(detail);
      finish();
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      await runJsonFallback(message, typingBubble);
      finish();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sawToken = false;

    startClientWatchdog(() => {
      if (abortController) {
        abortController.abort('client_watchdog');
        runJsonFallback(message, typingBubble);
      }
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = splitEvents(buffer + decoder.decode(value, { stream: true }), (event, payload) => {
        switch (event) {
          case 'start':
            break;
          case 'heartbeat':
            break;
        case 'token': {
          const token = payload?.token ?? '';
          if (!token) break;
          sawToken = true;
          clearClientWatchdog();
            appendToken(token);
            aggregated += token;
            break;
          }
          case 'done': {
            clearClientWatchdog();
          const reply = (payload?.reply || '').trim();
          if (!aggregated && reply) {
            aggregated = reply;
            setText(reply);
          }
          finish();
          break;
        }
          case 'error': {
            clearClientWatchdog();
            const detail = payload?.details || payload?.error || 'Unexpected server error.';
            setText(`Sorry, something went wrong: ${detail}`);
            finish();
            break;
          }
        case 'aborted': {
          clearClientWatchdog();
          const reason = payload?.reason || 'user_abort';
          if (reason === 'user_abort') {
            setText('Canceled.');
            finish();
          } else if (reason === 'client_watchdog') {
            // Client fallback already triggered.
          } else {
            finish();
          }
          break;
        }
          default:
            break;
        }
      });
    }

    if (!finished) {
      if (!sawToken && !clientFallbackTriggered) {
        await runJsonFallback(message, typingBubble);
        finish();
      } else {
        finish();
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!clientFallbackTriggered) {
        setText('Canceled.');
        finish();
      }
    } else {
      console.error(error);
      setText('Network error. Please try again.');
      finish();
    }
  }
}

sendBtn.addEventListener('click', () => sendMessage());
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

stopBtn.addEventListener('click', () => {
  if (abortController) {
    abortController.abort('user_abort');
  }
});

quickActions.forEach((btn) => {
  btn.addEventListener('click', () => {
    sendMessage(btn.dataset.prompt);
  });
});

if (newChatBtn) {
  newChatBtn.addEventListener('click', async () => {
    if (isStreaming && abortController) {
      abortController.abort('user_abort');
    } else {
      setStreamingState(false);
    }
    try {
      await fetch('/session/reset', {
        method: 'POST',
        headers: {
          'X-Client-ID': clientId,
          'X-Tenant-ID': TENANT_ID,
          'X-Bot-Token': BOT_PUBLIC_TOKEN,
          'X-Public-Token': BOT_PUBLIC_TOKEN,
        },
        credentials: 'include',
        mode: 'cors',
      });
    } catch (error) {
      console.error('Failed to reset session', error);
    }
    chat.innerHTML = '';
    addMessage('bot', INITIAL_BOT_GREETING);
    input.value = '';
    input.focus();
  });
}

async function updateApiStatus() {
  if (!statusBadge) return;
  try {
    const res = await fetch('/health', { credentials: 'include' });
    if (res.ok) {
      statusBadge.textContent = '✅ API connected';
      statusBadge.classList.remove('badge--error');
    } else {
      statusBadge.textContent = '⚠️ API offline';
      statusBadge.classList.add('badge--error');
    }
  } catch (error) {
    statusBadge.textContent = '⚠️ Offline';
    statusBadge.classList.add('badge--error');
    console.error('Health check failed:', error);
  }
}

updateApiStatus();

addMessage('bot', INITIAL_BOT_GREETING);
