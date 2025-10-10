const chat = document.getElementById('chat');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const statusBadge = document.getElementById('api-status');

function bubble(role, text) {
  const p = document.createElement('div');
  p.className = `msg ${role}`;
  p.textContent = text;
  chat.appendChild(p);
  chat.scrollTop = chat.scrollHeight;
}

function setSending(sending) {
  sendBtn.disabled = sending;
  sendBtn.textContent = sending ? 'Sending…' : 'Send';
  input.readOnly = sending;
}

async function send(text) {
  const msg = text ?? input.value.trim();
  if (!msg) return;
  bubble('user', msg);
  input.value = '';
  setSending(true);

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data?.details === 'string' ? data.details : '';
      const message = detail
        ? `Sorry, something went wrong: ${detail}`
        : `Sorry, I hit an error (${res.status}).`;
      bubble('bot', message);
      console.error('Server error:', data);
    } else if (!data.reply) {
      bubble('bot', 'Hmm, I could not generate a reply.');
    } else {
      bubble('bot', data.reply);
    }
  } catch (err) {
    bubble('bot', 'Network error. Please try again.');
    console.error(err);
  } finally {
    setSending(false);
    input.focus();
  }
}

sendBtn.onclick = () => send();
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) send();
});

// Quick actions
document.querySelectorAll('.action').forEach(btn => {
  btn.addEventListener('click', () => {
    send(btn.dataset.prompt);
    input.focus();
  });
});

async function updateApiStatus() {
  if (!statusBadge) return;
  try {
    const res = await fetch('/health');
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

// Seed greeting
bubble('bot', 'Hi there! How can I help with your cleaning today?');
