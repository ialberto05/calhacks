const API = 'http://localhost:4000';

let CFG = { vapiPublicKey: '', vapiAssistantId: '' };
let vapi = null;
let listening = false;

// ---------- Tabs ----------
(function wireTabs() {
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
      this.classList.add('active');
      var target = this.getAttribute('data-screen');
      var sections = document.querySelectorAll('section[id^="screen-"]');
      for (var k = 0; k < sections.length; k++) {
        sections[k].style.display = sections[k].id === 'screen-' + target ? '' : 'none';
      }
    });
  }
})();

// ---------- Helpers ----------
function toneClass(tone) { return 'tone tone-' + String(tone || 'neutral').toLowerCase(); }
function setStatus(s) { var el = document.getElementById('status'); if (el) el.textContent = s; }
var emojiMap = {
  frustrated: '😠', anxious: '😟', defensive: '😤', uncertain: '🤔',
  neutral: '😐', calm: '🙂', upbeat: '😄', confident: '😎'
};
function setEmoji(tone) {
  var el = document.getElementById('emoji');
  if (el) el.textContent = emojiMap[tone] || '😐';
}
function showAdvice(out) {
  setEmoji(out.tone);
  var badge = document.getElementById('toneBadge');
  badge.textContent = out.tone;
  badge.className = toneClass(out.tone);

  var ul = document.getElementById('bullets');
  ul.innerHTML = '';
  (out.bullets || []).forEach(function (b) {
    var li = document.createElement('li');
    li.textContent = b;
    ul.appendChild(li);
  });
  var why = document.getElementById('why');
  if (why) why.textContent = 'Why: ' + out.evidence + ' • Confidence: ' + out.confidence + '/5';
}
function isCustomer(label) {
  var s = String(label || '').toLowerCase();
  // tweak once you see a real event in console if needed:
  return /customer|user|caller|speaker_0/.test(s);
}
function fail(msg) { console.error(msg); alert(msg); }

// ---------- Vapi ----------
async function startVapi() {
  try {
    if (!CFG.vapiPublicKey || !CFG.vapiAssistantId) return fail('Vapi config missing from backend (/api/config).');

    // The ESM loader in index.html sets: window.VapiWeb = { default: VapiWeb }
    if (!window.VapiWeb || !window.VapiWeb.default) {
      return fail('Vapi SDK not loaded. Check the <script type="module"> block in index.html.');
    }

    // IMPORTANT: use 'publicKey' (not 'apiKey')
    vapi = new window.VapiWeb.default({ publicKey: CFG.vapiPublicKey });
    setStatus('initializing…');

    vapi.on('status', function (evt) {
      setStatus((evt && evt.status) || 'unknown');
    });

    vapi.on('transcript', async function (evt) {
      console.log('Vapi transcript:', evt); // inspect once to confirm field names
      var text    = (evt && (evt.text || evt.transcript)) || '';
      var final   = (evt && (evt.is_final !== undefined ? evt.is_final : evt.final)) || false;
      var speaker = (evt && (evt.speaker || evt.participant || evt.role || evt.channel)) || '';
      if (!final || !text) return;
      if (!isCustomer(speaker)) return;

      try {
        var r = await fetch(API + '/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, context: 'retail' })
        });
        var j = await r.json();
        if (j && j.ok) showAdvice(j);
        else console.warn('Analyze not ok:', j);
      } catch (err) {
        console.error('Analyze error:', err);
      }
    });

    await vapi.start({ assistantId: CFG.vapiAssistantId }); // mic prompt should appear here
    listening = true;
    document.getElementById('micBtn').classList.add('on');
    setStatus('listening');
  } catch (err) {
    console.error('Vapi start error (raw):', err);
    try { console.error('Vapi start error (json):', JSON.stringify(err)); } catch {}
    setStatus('error');
    var msg = (err && err.message) ? err.message
            : (err && err.type)    ? ('Event type: ' + err.type)
            : 'unknown error';
    fail('Vapi start error: ' + msg);
  }
}

async function stopVapi() {
  try { if (vapi && vapi.stop) await vapi.stop(); } catch (e) { console.warn('stop error', e); }
  listening = false;
  document.getElementById('micBtn').classList.remove('on');
  setStatus('stopped');
}

document.getElementById('micBtn').addEventListener('click', async function () {
  if (!listening) await startVapi(); else await stopVapi();
});

// ---------- Manual analyze (no mic) ----------
document.getElementById('analyzeBtn').addEventListener('click', async function () {
  var text = document.getElementById('utterance').value.trim();
  if (!text) return alert('Type something');
  try {
    var r = await fetch(API + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, context: 'retail' })
    });
    var j = await r.json();
    if (!j.ok) return fail('Backend error from /api/analyze');
    showAdvice(j);
  } catch (e) { fail('Network error calling /api/analyze'); }
});

// ---------- Summary ----------
document.getElementById('summaryBtn').addEventListener('click', async function () {
  var t = document.getElementById('summaryJson').value;
  var utterances;
  try { utterances = JSON.parse(t); }
  catch { return alert('Invalid JSON'); }
  try {
    var r = await fetch(API + '/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utterances: utterances })
    });
    var j = await r.json();
    document.getElementById('summaryOut').textContent = j.summary || '(no summary)';
  } catch (e) { fail('Network error calling /api/summary'); }
});

// ---------- Load /api/config on page load ----------
(async function init() {
  try {
    var r = await fetch(API + '/api/config');
    CFG = await r.json();
    console.log('Loaded /api/config:', CFG);
    if (!CFG.vapiPublicKey || !CFG.vapiAssistantId) {
      console.warn('Missing Vapi config; set VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID in backend .env and restart.');
    }
  } catch (e) {
    console.error('Failed to load /api/config', e);
    fail('Cannot load /api/config. Is the backend running on :4000?');
  }
})();

// Optional: catch silent promise errors
window.addEventListener('unhandledrejection', function (e) {
  console.error('Unhandled rejection:', e.reason || e);
});
