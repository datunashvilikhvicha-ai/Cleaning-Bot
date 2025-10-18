const FALLBACK_TENANT = "__FALLBACK_TENANT__";

(function () {
  console.log('[NeuroX Widget] initialized', new Date().toISOString());

  var scriptEl = document.currentScript;
  if (!scriptEl) {
    console.error('[neurox-widget] unable to locate current script element.');
    return;
  }

  var dataset = scriptEl.dataset || {};
  var tenantId = ((dataset.tenant || FALLBACK_TENANT) || '').toLowerCase();
  var token = dataset.token || '';
  var apiBase =
    dataset.base ||
    (function () {
      try {
        return new URL(scriptEl.src, window.location.href).origin;
      } catch (error) {
        console.warn('[neurox-widget] failed to derive API base URL.', error);
        return '';
      }
    })();

  if (!token) {
    console.error('[neurox-widget] missing data-token attribute on embed script.');
    return;
  }

  if (!apiBase) {
    console.error('[neurox-widget] unable to resolve API base URL.');
    return;
  }

  var apiUrl = apiBase.replace(/\/+$/, '') + '/chat';
  var storageKey = 'cleaning-bot-client-' + tenantId;

  function ensureClientId() {
    try {
      var stored = localStorage.getItem(storageKey);
      if (stored) return stored;
    } catch (error) {
      console.warn('[neurox-widget] localStorage unavailable. continuing anonymously.', error);
    }
    var fallbackId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'nx-client-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    try {
      localStorage.setItem(storageKey, fallbackId);
    } catch (error) {
      /* ignore */
    }
    return fallbackId;
  }

  var clientId = ensureClientId();
  var isNeuroxTenant = tenantId === 'neurox';

  function callChat(question) {
    return fetch(apiUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Stream-Mode': 'json',
        'X-Client-ID': clientId,
        'X-Tenant-ID': tenantId,
        'X-Bot-Token': token,
        'X-Public-Token': token,
      },
      body: JSON.stringify({ message: question }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            var reply = (payload.reply || payload.details || '').trim();
            if (!response.ok) {
              throw new Error(reply || 'Unexpected error');
            }
            return reply;
          });
      });
  }

  function injectStyle(id, cssText) {
    if (document.getElementById(id)) return;
    var styleEl = document.createElement('style');
    styleEl.id = id;
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);
  }

  if (isNeuroxTenant) {
    mountNeurox();
  } else {
    mountClassic();
  }

  function mountNeurox() {
    injectStyle(
      'neurox-widget-style',
      [
        '.nxw-root{position:fixed;z-index:2147483647;font-family:"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fafc;right:24px;bottom:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));}',
        '.nxw-root[data-position="right"]{left:auto;right:24px;}',
        '.nxw-root[data-position="left"]{left:24px;right:auto;}',
        '@media(max-width:520px){.nxw-root{left:50%!important;right:auto!important;bottom:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);}}',
        '.nxw-launcher{all:unset;position:relative;display:flex;align-items:center;gap:12px;padding:12px 18px;border-radius:999px;background:linear-gradient(135deg,#2563eb,#9333ea);color:#f8fafc;font-weight:600;cursor:pointer;box-shadow:0 20px 48px rgba(59,130,246,0.45);transition:transform 0.25s ease,box-shadow 0.25s ease;}',
        '.nxw-launcher:hover{transform:translateY(-2px);box-shadow:0 30px 60px rgba(147,51,234,0.48);}',
        '.nxw-launcher__icon{display:grid;place-items:center;width:34px;height:34px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:16px;}',
        '.nxw-launcher__label{font-size:0.95rem;letter-spacing:0.02em;}',
        '.nxw-launcher__pulse{position:absolute;inset:-12px;border-radius:999px;background:radial-gradient(circle,rgba(56,189,248,0.45),transparent 70%);animation:nxw-pulse 2.2s ease-in-out infinite;z-index:-1;}',
        '.nxw-root--open .nxw-launcher{display:none;}',
        '.nxw-shell{width:360px;max-width:calc(100vw - 32px);height:520px;display:flex;flex-direction:column;border-radius:26px;border:1px solid rgba(148,163,184,0.22);background:rgba(11,17,31,0.92);backdrop-filter:blur(24px);box-shadow:0 44px 120px rgba(8,15,31,0.7);opacity:0;transform:translateY(14px) scale(0.96);pointer-events:none;transition:opacity 0.28s ease,transform 0.32s cubic-bezier(0.34,1.56,0.64,1);}',
        '.nxw-root--open .nxw-shell{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}',
        '@media(max-width:520px){.nxw-shell{width:min(92vw,420px);height:min(92vh,620px);}}',
        '.nxw-header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 24px;background:linear-gradient(135deg,rgba(37,99,235,0.94),rgba(147,51,234,0.88));border-radius:26px 26px 0 0;border-bottom:1px solid rgba(148,163,184,0.25);}',
        '.nxw-header__info{display:flex;flex-direction:column;gap:6px;}',
        '.nxw-header__title{margin:0;font-size:1.06rem;font-weight:600;letter-spacing:0.02em;}',
        '.nxw-header__subtitle{margin:0;color:rgba(224,242,254,0.78);font-size:0.83rem;}',
        '.nxw-header__close{all:unset;width:32px;height:32px;border-radius:12px;display:grid;place-items:center;color:rgba(248,250,252,0.92);cursor:pointer;transition:background 0.2s ease,transform 0.2s ease;}',
        '.nxw-header__close:hover{background:rgba(255,255,255,0.18);transform:scale(1.05);}',
        '.nxw-messages{flex:1;padding:22px;background:linear-gradient(180deg,rgba(15,23,42,0.7),rgba(10,15,31,0.86));overflow-y:auto;display:flex;flex-direction:column;gap:16px;}',
        '.nxw-messages::-webkit-scrollbar{width:6px;}',
        '.nxw-messages::-webkit-scrollbar-thumb{background:rgba(148,163,184,0.38);border-radius:999px;}',
        '.nxw-msg{position:relative;max-width:85%;padding:13px 17px;border-radius:18px;font-size:0.95rem;line-height:1.6;box-shadow:0 20px 48px rgba(8,15,31,0.28);backdrop-filter:blur(8px);animation:nxw-fade 0.35s ease;}',
        '.nxw-msg--user{align-self:flex-end;background:linear-gradient(135deg,#2563eb,#38bdf8);color:#ffffff;}',
        '.nxw-msg--bot{align-self:flex-start;background:rgba(15,23,42,0.88);color:#e2e8f0;border:1px solid rgba(148,163,184,0.22);}',
        '.nxw-msg--error{background:rgba(248,113,113,0.18);color:#fecaca;border:1px solid rgba(248,113,113,0.4);}',
        '.nxw-msg--typing{display:inline-flex;align-items:center;gap:8px;color:rgba(224,242,254,0.8);}',
        '.nxw-typing{display:inline-flex;gap:4px;margin-left:6px;}',
        '.nxw-typing-dot{width:6px;height:6px;border-radius:999px;background:rgba(56,189,248,0.85);animation:nxw-typing 1.1s ease-in-out infinite;}',
        '.nxw-typing-dot:nth-child(2){animation-delay:0.18s;}',
        '.nxw-typing-dot:nth-child(3){animation-delay:0.36s;}',
        '.nxw-form{padding:18px 20px;display:flex;gap:12px;align-items:center;background:rgba(10,15,31,0.88);border-top:1px solid rgba(148,163,184,0.22);border-radius:0 0 26px 26px;}',
        '.nxw-input{flex:1;border-radius:16px;border:1px solid rgba(148,163,184,0.28);background:rgba(15,23,42,0.75);color:#f8fafc;padding:12px 16px;font-size:0.95rem;transition:border 0.2s ease,box-shadow 0.2s ease;}',
        '.nxw-input::placeholder{color:rgba(148,163,184,0.65);}',
        '.nxw-input:focus{outline:none;border-color:rgba(56,189,248,0.5);box-shadow:0 0 0 2px rgba(56,189,248,0.18);}',
        '.nxw-send{width:48px;height:48px;border-radius:16px;border:none;display:grid;place-items:center;background:linear-gradient(135deg,#2563eb,#9333ea);color:#f8fafc;font-size:1.1rem;cursor:pointer;box-shadow:0 20px 48px rgba(59,130,246,0.4);transition:transform 0.2s ease,box-shadow 0.2s ease;}',
        '.nxw-send:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 26px 60px rgba(147,51,234,0.46);}',
        '.nxw-send[disabled]{opacity:0.45;cursor:not-allowed;transform:none;box-shadow:none;}',
        '@keyframes nxw-typing{0%,80%,100%{opacity:0.2;transform:translateY(0);}40%{opacity:1;transform:translateY(-2px);}}',
        '@keyframes nxw-fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}',
        '@keyframes nxw-pulse{0%,100%{transform:scale(1);opacity:0.75;}50%{transform:scale(1.25);opacity:0;}}',
      ].join(''),
    );

    var container = document.createElement('div');
    container.className = 'nxw-root';
    container.dataset.position = dataset.position === 'left' ? 'left' : 'right';

    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'nxw-launcher';
    launcher.innerHTML =
      '<span class="nxw-launcher__pulse" aria-hidden="true"></span>' +
      '<span class="nxw-launcher__icon" aria-hidden="true">💬</span>' +
      '<span class="nxw-launcher__label">' +
      (dataset.buttonLabel || 'Ask Neuro X') +
      '</span>';

    var shell = document.createElement('div');
    shell.className = 'nxw-shell';

    var header = document.createElement('header');
    header.className = 'nxw-header';
    var headerInfo = document.createElement('div');
    headerInfo.className = 'nxw-header__info';
    headerInfo.innerHTML =
      '<p class="nxw-header__title">' +
      (dataset.title || 'Neuro X Assistant') +
      '</p><p class="nxw-header__subtitle">' +
      (dataset.subtitle || 'We respond in seconds with product-tailored answers.') +
      '</p>';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'nxw-header__close';
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.innerHTML = '&times;';

    var messagesEl = document.createElement('div');
    messagesEl.className = 'nxw-messages';

    var form = document.createElement('form');
    form.className = 'nxw-form';
    var inputEl = document.createElement('input');
    inputEl.className = 'nxw-input';
    inputEl.type = 'text';
    inputEl.placeholder = dataset.placeholder || 'Ask about services, pricing, or integrations…';
    var sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.className = 'nxw-send';
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.textContent = '➤';

    form.appendChild(inputEl);
    form.appendChild(sendBtn);

    header.appendChild(headerInfo);
    header.appendChild(closeBtn);
    shell.appendChild(header);
    shell.appendChild(messagesEl);
    shell.appendChild(form);
    container.appendChild(launcher);
    container.appendChild(shell);
    document.body.appendChild(container);

    function scrollToBottom(el) {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } catch (error) {
        el.scrollTop = el.scrollHeight;
      }
    }

    function appendMessage(role, text, extra) {
      var bubble = document.createElement('div');
      bubble.className = 'nxw-msg nxw-msg--' + role + (extra ? ' ' + extra : '');
      bubble.textContent = text;
      messagesEl.appendChild(bubble);
      scrollToBottom(messagesEl);
      return bubble;
    }

    function createTypingBubble() {
      var bubble = document.createElement('div');
      bubble.className = 'nxw-msg nxw-msg--bot nxw-msg--typing';
      var label = document.createElement('span');
      label.textContent = dataset.typingLabel || 'Neuro X is replying';
      bubble.appendChild(label);
      var dots = document.createElement('span');
      dots.className = 'nxw-typing';
      dots.innerHTML = '<span class="nxw-typing-dot"></span><span class="nxw-typing-dot"></span><span class="nxw-typing-dot"></span>';
      bubble.appendChild(dots);
      messagesEl.appendChild(bubble);
      scrollToBottom(messagesEl);
      return bubble;
    }

    function openWidget() {
      if (!container.classList.contains('nxw-root--open')) {
        container.classList.add('nxw-root--open');
        setTimeout(function () {
          scrollToBottom(messagesEl);
          inputEl.focus();
        }, 180);
      }
    }

    function closeWidget() {
      container.classList.remove('nxw-root--open');
    }

    launcher.addEventListener('click', openWidget);
    closeBtn.addEventListener('click', closeWidget);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeWidget();
      }
    });

    appendMessage(
      'bot',
      dataset.greeting || "Hey! I'm the Neuro X assistant. How can I support you today?",
      'nxw-msg--intro'
    );

    if (dataset.autoplay === 'true' || dataset.autoOpen === 'true') {
      setTimeout(openWidget, Number(dataset.delay || 600));
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!inputEl.value.trim() || sendBtn.disabled) {
        return;
      }

      var question = inputEl.value.trim();
      inputEl.value = '';
      appendMessage('user', question);

      sendBtn.disabled = true;
      inputEl.disabled = true;

      var typingBubble = createTypingBubble();

      callChat(question)
        .then(function (reply) {
          var responseText = reply || 'Happy to help! Let me know if you need anything else.';
          typingBubble.textContent = responseText;
          typingBubble.classList.remove('nxw-msg--typing');
        })
        .catch(function (error) {
          typingBubble.textContent = 'Sorry, something went wrong. Please try again.';
          typingBubble.classList.remove('nxw-msg--typing');
          typingBubble.classList.add('nxw-msg--error');
          console.error('[neurox-widget] request failed:', error);
        })
        .finally(function () {
          sendBtn.disabled = false;
          inputEl.disabled = false;
          inputEl.focus();
        });
    });
  }

  function mountClassic() {
    injectStyle(
      'cbw-style',
      [
        '.cbw-container{position:fixed;z-index:2147483000;font-family:"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;}',
        '.cbw-container[data-position="right"]{right:24px;bottom:24px;}',
        '.cbw-container[data-position="left"]{left:24px;bottom:24px;}',
        '.cbw-button{all:unset;display:flex;align-items:center;justify-content:center;gap:10px;background:#2563eb;color:#fff;padding:14px 18px;border-radius:999px;box-shadow:0 12px 32px rgba(37,99,235,0.4);cursor:pointer;font-weight:600;transition:transform 0.2s ease,box-shadow 0.2s ease;}',
        '.cbw-button:hover{transform:translateY(-1px);box-shadow:0 16px 36px rgba(37,99,235,0.45);}',
        '.cbw-button-icon{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:rgba(255,255,255,0.2);font-size:16px;}',
        '.cbw-panel{display:none;flex-direction:column;width:360px;height:520px;background:#fff;border-radius:18px;box-shadow:0 24px 48px rgba(15,23,42,0.2);overflow:hidden;}',
        '.cbw-open .cbw-panel{display:flex;}',
        '.cbw-open .cbw-button{display:none;}',
        '.cbw-header{padding:16px 18px;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;display:flex;align-items:center;justify-content:space-between;}',
        '.cbw-header-title{font-size:16px;font-weight:600;margin:0;}',
        '.cbw-header-subtitle{margin:4px 0 0;font-size:13px;opacity:0.8;}',
        '.cbw-close{all:unset;font-size:18px;cursor:pointer;color:rgba(255,255,255,0.85);padding:4px;}',
        '.cbw-messages{flex:1;padding:18px;background:#f8fafc;overflow-y:auto;display:flex;flex-direction:column;gap:12px;}',
        '.cbw-message{padding:10px 14px;border-radius:14px;line-height:1.4;max-width:85%;box-shadow:0 8px 20px rgba(15,23,42,0.08);white-space:pre-wrap;word-break:break-word;font-size:14px;animation:cbw-fade 0.24s ease;}',
        '.cbw-message.cbw-user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:6px;}',
        '.cbw-message.cbw-bot{align-self:flex-start;background:#fff;color:#0f172a;border-bottom-left-radius:6px;}',
        '.cbw-message.cbw-error{background:#fee2e2;color:#991b1b;}',
        '.cbw-input{display:flex;gap:10px;padding:14px 16px;background:#fff;border-top:1px solid #e2e8f0;}',
        '.cbw-input input{flex:1;padding:12px 14px;border-radius:999px;border:1px solid #cbd5f5;font-size:14px;outline:none;}',
        '.cbw-input input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,0.2);}',
        '.cbw-input button{all:unset;padding:12px 18px;border-radius:999px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;transition:background 0.2s ease;}',
        '.cbw-input button:hover{background:#1e40af;}',
        '.cbw-input button[disabled]{opacity:0.65;cursor:not-allowed;}',
        '.cbw-typing{display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;}',
        '.cbw-typing-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:cbw-bounce 1s infinite;}',
        '.cbw-typing-dot:nth-child(2){animation-delay:0.15s;}',
        '.cbw-typing-dot:nth-child(3){animation-delay:0.3s;}',
        '@keyframes cbw-bounce{0%,80%,100%{transform:scale(0);}40%{transform:scale(1);}}',
        '@keyframes cbw-fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}',
      ].join(''),
    );

    var container = document.createElement('div');
    container.className = 'cbw-container cbw-collapsed';
    container.dataset.position = dataset.position === 'left' ? 'left' : 'right';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cbw-button';
    button.innerHTML = '<span class="cbw-button-icon">💬</span><span class="cbw-button-label">' +
      (dataset.buttonLabel || 'Chat with us') +
      '</span>';

    var panel = document.createElement('div');
    panel.className = 'cbw-panel';

    var header = document.createElement('header');
    header.className = 'cbw-header';
    var headerText = document.createElement('div');
    headerText.innerHTML = '<p class="cbw-header-title">' +
      (dataset.title || 'Need a hand?') +
      '</p><p class="cbw-header-subtitle">' +
      (dataset.subtitle || 'We reply in seconds.') +
      '</p>';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'cbw-close';
    close.setAttribute('aria-label', 'Close chat');
    close.innerHTML = '&times;';

    var messages = document.createElement('div');
    messages.className = 'cbw-messages';

    var form = document.createElement('form');
    form.className = 'cbw-input';
    var inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = dataset.placeholder || 'Ask about services, pricing, booking…';
    var sendBtn = document.createElement('button');
    sendBtn.type = 'submit';
    sendBtn.textContent = dataset.sendLabel || 'Send';

    form.appendChild(inputEl);
    form.appendChild(sendBtn);

    header.appendChild(headerText);
    header.appendChild(close);
    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(form);
    container.appendChild(button);
    container.appendChild(panel);
    document.body.appendChild(container);

    function appendMessage(role, text, extra) {
      var msg = document.createElement('div');
      msg.className = 'cbw-message cbw-' + role + (extra ? ' ' + extra : '');
      msg.textContent = text;
      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
      return msg;
    }

    function createTypingBubble() {
      var bubble = document.createElement('div');
      bubble.className = 'cbw-message cbw-bot cbw-typing';
      bubble.innerHTML = 'Thinking <span class="cbw-typing-dot"></span><span class="cbw-typing-dot"></span><span class="cbw-typing-dot"></span>';
      messages.appendChild(bubble);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }

    button.addEventListener('click', function () {
      container.classList.add('cbw-open');
      messages.scrollTop = messages.scrollHeight;
      inputEl.focus();
    });

    close.addEventListener('click', function () {
      container.classList.remove('cbw-open');
    });

    appendMessage('bot', dataset.greeting || 'Hi there! How can we help today?');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!inputEl.value.trim() || sendBtn.disabled) {
        return;
      }

      var question = inputEl.value.trim();
      inputEl.value = '';
      appendMessage('user', question);

      sendBtn.disabled = true;
      inputEl.disabled = true;
      var typingBubble = createTypingBubble();

      callChat(question)
        .then(function (reply) {
          var responseText = reply || 'We are here if you need anything else.';
          typingBubble.textContent = responseText;
          typingBubble.classList.remove('cbw-typing');
        })
        .catch(function (error) {
          typingBubble.textContent = 'Sorry, something went wrong. Please try again.';
          typingBubble.classList.remove('cbw-typing');
          typingBubble.classList.add('cbw-error');
          console.error('[neurox-widget] request failed:', error);
        })
        .finally(function () {
          sendBtn.disabled = false;
          inputEl.disabled = false;
          inputEl.focus();
        });
    });
  }
})();
