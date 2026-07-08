const BASE = (function() {
  const m = document.querySelector('meta[name="gateway-prefix"]');
  if (m && m.content) return m.content;
  const p = window.location.pathname;
  const idx = p.lastIndexOf('/app/');
  if (idx >= 0) {
    const end = p.indexOf('/', idx + 5);
    return end > 0 ? p.substring(idx, end) : p.substring(idx);
  }
  return '';
})();

const api = {
  async get(p) { const r=await fetch(BASE+p); if(!r.ok) throw await r.text(); return r.json(); },
  async post(p,b) { const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}); if(!r.ok) throw await r.text(); return r.json(); },
  async put(p,b) { const r=await fetch(BASE+p,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); if(!r.ok) throw await r.text(); return r.json(); },
  async del(p) { const r=await fetch(BASE+p,{method:'DELETE'}); if(!r.ok) throw await r.text(); return r.json(); }
};

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast ' + (err ? 'toast-error' : 'toast-success');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function fmtBytes(n) {
  if (!n || n===0) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i=0, v=n;
  while(v>=1024 && i<u.length-1) { v/=1024; i++; }
  return v.toFixed(i>0?1:0)+' '+u[i];
}

function ago(ts) {
  if (!ts || ts==='0') return '—';
  const t = parseInt(ts), d = Math.floor(Date.now()/1000) - t;
  if (isNaN(t) || d<0) return ts;
  if (d<60) return d+'s ago';
  if (d<3600) return Math.floor(d/60)+'m ago';
  if (d<86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
}

let statePeers = [];
let stateIface = {};
let stateRunning = false;
let livePeers = {};
let pollTimer = null;

async function load() {
  try {
    const [status, peers, settings] = await Promise.all([
      api.get('/api/status'), api.get('/api/peers'), api.get('/api/settings')
    ]);
    stateRunning = status.running; statePeers = peers; stateIface = settings;
    if (status.status && status.status.peers) {
      livePeers = {}; for (const p of status.status.peers) livePeers[p.publicKey] = p;
    }
  } catch(e) { stateRunning = false; }
}

async function refreshStatus() {
  try {
    const [status, peers] = await Promise.all([api.get('/api/status'), api.get('/api/peers')]);
    stateRunning = status.running; statePeers = peers;
    if (status.status && status.status.peers) {
      livePeers = {}; for (const p of status.status.peers) livePeers[p.publicKey] = p;
    } else { livePeers = {}; }
    updateInterfaceInfo(status.status);
    updateStatusPill(); updatePeerTable();
  } catch(e) {}
}

function updateInterfaceInfo(s) {
  const el = document.getElementById('iface-live');
  if (!el || !s) return;
  el.innerHTML = 
    '<div class="setting-item-readonly"><label>Public Key</label><span class="mono">'+esc(s.publicKey||'(not set)')+'</span></div>'+
    '<div class="setting-item-readonly"><label>Listen Port</label><span>'+s.listenPort+'</span></div>';
}

function updateStatusPill() {
  const pill = document.getElementById('status-pill'), btn = document.getElementById('toggle-btn');
  if (!pill || !btn) return;
  pill.className = 'status-pill ' + (stateRunning ? 'on' : 'off');
  pill.innerHTML = '<span class="dot '+(stateRunning?'on':'off')+'"></span>'+(stateRunning?'Running':'Stopped');
  btn.className = 'btn ' + (stateRunning ? 'btn-danger' : 'btn-primary');
  btn.textContent = stateRunning ? 'Stop' : 'Apply';
}

function updatePeerTable() {
  const tbody = document.getElementById('peer-tbody');
  if (!tbody) return;
  const cnt = document.getElementById('peer-count');
  if (cnt) cnt.textContent = '(' + statePeers.length + ')';
  if (statePeers.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No peers. Import a config or add one manually.</td></tr>';
    return;
  }
  tbody.innerHTML = statePeers.map(p => {
    const live = livePeers[p.publicKey];
    return '<tr>'+
      '<td><strong>'+esc(p.name)+'</strong></td>'+
      '<td><span class="mono">'+esc(p.publicKey)+'</span></td>'+
      '<td><span class="mono">'+esc(p.allowedIPs)+'</span></td>'+
      '<td>'+(live?'<span class="mono">'+esc(live.endpoint||'—')+'</span>':'—')+'</td>'+
      '<td>'+(live?fmtBytes(live.transferRx)+' ↓ / '+fmtBytes(live.transferTx)+' ↑':'—')+'</td>'+
      '<td>'+(live?ago(live.latestHandshake):'—')+'</td>'+
      '<td><div class="row-actions">'+
        '<button class="icon-btn" title="Download config" onclick="downloadConfig(\''+p.id+'\')">⬇</button>'+
        '<button class="icon-btn" title="Edit" onclick="showPeerModal(\''+p.id+'\')">✎</button>'+
        '<button class="icon-btn danger" title="Delete" onclick="deletePeer(\''+p.id+'\')">✕</button>'+
      '</div></td></tr>';
  }).join('');
}

async function applyWG() {
  try { await api.post('/api/apply'); await load(); render(); toast('Applied'); } catch(e) { toast('Error: ' + e, true); }
}

async function stopWG() {
  try {
    const wasRunning = stateRunning;
    stateRunning = false; updateStatusPill();
    await api.post('/api/stop');
    await load(); render();
  } catch(e) { stateRunning = true; updateStatusPill(); toast('Error: ' + e, true); }
}

function showImportModal() {
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-overlay" id="import-modal"><div class="modal">'+
    '<h3>Import WireGuard Config</h3>'+
    '<div class="form-group"><label>Paste a standard wg-quick config file:</label>'+
    '<textarea id="im-config" rows="16" placeholder="[Interface]\nPrivateKey = ...\nAddress = 10.0.0.1/24\nListenPort = 51820\n\n[Peer]\nPublicKey = ...\nAllowedIPs = 10.0.0.2/32\n"></textarea></div>'+
    '<div class="modal-actions">'+
      '<button class="btn btn-outline" onclick="closeImportModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="doImport()">Import</button>'+
    '</div></div></div>');
}

function closeImportModal() { document.getElementById('import-modal')?.remove(); }

async function doImport() {
  const config = document.getElementById('im-config').value.trim();
  if (!config) { toast('Paste a config first', true); return; }
  try {
    await api.post('/api/import', { config: config });
    closeImportModal(); await load(); render();
    toast('Config imported — click Apply to activate');
  } catch(e) { toast('Import failed: ' + e, true); }
}

async function saveSettingsAndApply() {
  const data = {
    privateKey: document.getElementById('s-privkey').value.trim(),
    address: document.getElementById('s-address').value.trim(),
    listenPort: parseInt(document.getElementById('s-port').value) || 0,
    dns: document.getElementById('s-dns').value.trim(),
    mtu: parseInt(document.getElementById('s-mtu').value) || 0,
    table: document.getElementById('s-table').value.trim(),
    preUp: document.getElementById('s-preup').value.trim(),
    postUp: document.getElementById('s-postup').value.trim(),
    preDown: document.getElementById('s-predown').value.trim(),
    postDown: document.getElementById('s-postdown').value.trim(),
    saveConfig: document.getElementById('s-saveconfig').checked
  };
  try {
    const saved = await api.put('/api/settings', data);
    stateIface = saved;
    await api.post('/api/apply');
    await load(); render();
    toast('Saved & applied');
  } catch(e) { toast('Error: ' + e, true); }
}

function downloadConfig(id) {
  const ep = prompt('Server endpoint (e.g. 1.2.3.4:51820):');
  window.open(BASE+'/api/peer-config/'+id+(ep?'?endpoint='+encodeURIComponent(ep):''), '_blank');
}

async function deletePeer(id) {
  if (!confirm('Delete this peer?')) return;
  await api.del('/api/peers/'+id); await load(); render(); toast('Peer deleted');
}

function showPeerModal(id) {
  const existing = id ? statePeers.find(p=>p.id===id) : null;
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-overlay" id="peer-modal"><div class="modal">'+
    '<h3>'+(existing?'Edit Peer':'Add Peer')+'</h3>'+
    '<div class="form-row">'+
      '<div class="form-group"><label>Name</label><input id="pm-name" value="'+esc(existing?.name||'')+'"></div>'+
      '<div class="form-group"><label>Allowed IPs</label><input id="pm-allowed" value="'+esc(existing?.allowedIPs||'')+'" placeholder="10.252.0.2/32"></div>'+
    '</div>'+
    '<div class="form-group"><label>Public Key *</label><input id="pm-pubkey" value="'+esc(existing?.publicKey||'')+'" placeholder="Paste peer\'s public key"></div>'+
    '<div class="form-group"><label>Private Key (optional)</label><input id="pm-privkey" value="'+esc(existing?.privateKey||'')+'"></div>'+
    '<div class="form-group"><label>Preshared Key (optional)</label><input id="pm-psk" value="'+esc(existing?.presharedKey||'')+'"></div>'+
    '<div class="form-row">'+
      '<div class="form-group"><label>Endpoint</label><input id="pm-endpoint" value="'+esc(existing?.endpoint||'')+'" placeholder="peer.example.com:51820"></div>'+
      '<div class="form-group"><label>Keepalive (s)</label><input id="pm-keepalive" value="'+(existing?.persistentKeepalive??25)+'" type="number" min="0"></div>'+
    '</div>'+
    '<div class="modal-actions">'+
      '<button class="btn btn-outline" onclick="closePeerModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="savePeer(\''+(id||'')+'\')">Save</button>'+
    '</div></div></div>');
}

function closePeerModal() { document.getElementById('peer-modal')?.remove(); }

async function viewConfigFile() {
  try {
    const d = await api.get('/api/config-file');
    const content = d.config || '(empty — no config file yet)';
    document.body.insertAdjacentHTML('beforeend',
      '<div class="modal-overlay" id="cfg-modal"><div class="modal" style="max-width:640px">'+
      '<h3>Current wg0.conf</h3>'+
      '<pre style="background:#f5f7fa;padding:16px;border-radius:6px;overflow-x:auto;font-size:12px;font-family:ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto">'+
      esc(content)+'</pre>'+
      '<div class="modal-actions"><button class="btn btn-outline" onclick="document.getElementById(\'cfg-modal\').remove()">Close</button></div>'+
      '</div></div>');
  } catch(e) { toast('Error: '+e, true); }
}

async function savePeer(id) {
  const data = {
    name: document.getElementById('pm-name').value.trim(),
    allowedIPs: document.getElementById('pm-allowed').value.trim(),
    publicKey: document.getElementById('pm-pubkey').value.trim(),
    privateKey: document.getElementById('pm-privkey').value.trim(),
    presharedKey: document.getElementById('pm-psk').value.trim(),
    endpoint: document.getElementById('pm-endpoint').value.trim(),
    persistentKeepalive: parseInt(document.getElementById('pm-keepalive').value)||0
  };
  if (!data.name || !data.allowedIPs || !data.publicKey) { toast('Name, Allowed IPs and Public Key required', true); return; }
  try {
    if (id) await api.put('/api/peers/'+id, data); else await api.post('/api/peers', data);
    closePeerModal(); await load(); render(); toast('Peer saved');
  } catch(e) { toast('Error: ' + e, true); }
}

function render() {
  document.getElementById('app').innerHTML =
'<div class="topbar">'+
  '<h1>WireGuard</h1>'+
  '<div class="toggle-group">'+
    '<span class="status-pill '+(stateRunning?'on':'off')+'" id="status-pill"><span class="dot '+(stateRunning?'on':'off')+'"></span>'+(stateRunning?'Running':'Stopped')+'</span>'+
    (stateRunning
      ? '<button class="btn btn-danger" id="toggle-btn" onclick="stopWG()">Stop</button>'
      : '<button class="btn btn-primary btn-sm" onclick="showImportModal()">Import</button>'+
        '<button class="btn btn-primary" id="toggle-btn" onclick="applyWG()">Apply</button>')+
  '</div>'+
'</div>'+

'<div class="card">'+
  '<div class="card-header"><h2>Interface</h2></div>'+
  '<div class="card-body" style="padding:16px 20px">'+
    '<div class="settings-grid">'+
      '<div class="setting-item"><label>Private Key</label><input id="s-privkey" value="'+esc(stateIface.privateKey||'')+'"></div>'+
      '<div class="setting-item"><label>Address</label><input id="s-address" value="'+esc(stateIface.address||'')+'"></div>'+
      '<div class="setting-item"><label>Listen Port</label><input id="s-port" value="'+(stateIface.listenPort||'')+'" type="number"></div>'+
      '<div class="setting-item"><label>DNS</label><input id="s-dns" value="'+esc(stateIface.dns||'')+'"></div>'+
      '<div class="setting-item"><label>MTU</label><input id="s-mtu" value="'+(stateIface.mtu||'')+'" type="number"></div>'+
      '<div class="setting-item"><label>Table</label><input id="s-table" value="'+esc(stateIface.table||'')+'" placeholder="auto"></div>'+
    '</div>'+
    '<div class="collapse-toggle" style="padding:0 0 8px 20px;font-size:12px;color:#64748b" onclick="var b=this.nextElementSibling;b.style.display=b.style.display==\'none\'?\'block\':\'none\';this.querySelector(\'.arrow\').textContent=b.style.display==\'none\'?\'▶\':\'▼\'">'+
      '<span class="arrow" style="font-size:9px">▶</span> Advanced (PreUp / PostUp / PreDown / PostDown)'+
    '</div>'+
    '<div style="display:none">'+
      '<div class="settings-grid" style="padding-top:0">'+
        '<div class="setting-item full"><label>PreUp</label><textarea id="s-preup" rows="2">'+esc(stateIface.preUp||'')+'</textarea></div>'+
        '<div class="setting-item full"><label>PostUp</label><textarea id="s-postup" rows="2">'+esc(stateIface.postUp||'')+'</textarea></div>'+
        '<div class="setting-item full"><label>PreDown</label><textarea id="s-predown" rows="2">'+esc(stateIface.preDown||'')+'</textarea></div>'+
        '<div class="setting-item full"><label>PostDown</label><textarea id="s-postdown" rows="2">'+esc(stateIface.postDown||'')+'</textarea></div>'+
        '<div class="setting-item"><label><input type="checkbox" id="s-saveconfig" '+(stateIface.saveConfig?'checked':'')+' style="width:auto;margin-right:6px">SaveConfig</label></div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-top:8px;padding:0 20px 12px;display:flex;gap:8px;align-items:center">'+
      '<button class="btn btn-primary" onclick="saveSettingsAndApply()">Save & Apply</button>'+
      '<button class="btn btn-outline btn-sm" onclick="viewConfigFile()">View Config</button>'+
      '<span class="mono" id="iface-live" style="font-size:11px;color:#909399;margin-left:16px"></span>'+
    '</div>'+
  '</div>'+
'</div>'+

'<div class="card">'+
  '<div class="card-header">'+
    '<h2>Peers <span id="peer-count">('+statePeers.length+')</span></h2>'+
    '<button class="btn btn-primary btn-sm" onclick="showPeerModal()">+ Add Peer</button>'+
  '</div>'+
  '<div class="card-body"><table><thead><tr><th>Name</th><th>Public Key</th><th>Allowed IPs</th><th>Endpoint</th><th>Transfer</th><th>Handshake</th><th></th></tr></thead>'+
  '<tbody id="peer-tbody">'+(statePeers.length===0
    ? '<tr class="empty-row"><td colspan="7">No peers. Import a config or add one manually.</td></tr>'
    : statePeers.map(p=>{
        const live = livePeers[p.publicKey];
        return '<tr>'+
          '<td><strong>'+esc(p.name)+'</strong></td>'+
          '<td><span class="mono">'+esc(p.publicKey)+'</span></td>'+
          '<td><span class="mono">'+esc(p.allowedIPs)+'</span></td>'+
          '<td>'+(live?'<span class="mono">'+esc(live.endpoint||'—')+'</span>':'—')+'</td>'+
          '<td>'+(live?fmtBytes(live.transferRx)+' ↓ / '+fmtBytes(live.transferTx)+' ↑':'—')+'</td>'+
          '<td>'+(live?ago(live.latestHandshake):'—')+'</td>'+
          '<td><div class="row-actions">'+
            '<button class="icon-btn" title="Download" onclick="downloadConfig(\''+p.id+'\')">⬇</button>'+
            '<button class="icon-btn" title="Edit" onclick="showPeerModal(\''+p.id+'\')">✎</button>'+
            '<button class="icon-btn danger" title="Delete" onclick="deletePeer(\''+p.id+'\')">✕</button>'+
          '</div></td></tr>';
      }).join('')
  )+'</tbody></table></div>'+
'</div>';
}

function startPolling() { if (!pollTimer) pollTimer = setInterval(refreshStatus, 3000); }

(async function init() { await load(); render(); startPolling(); })();
