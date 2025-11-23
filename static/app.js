// static/app.js
// VyOS Config Viewer JavaScript

console.log('VyOS Config Viewer JS loaded');

const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const menu = document.getElementById('menu');
const content = document.getElementById('content');
const themeSelect = document.getElementById('themeSelect');

// --- THEME LOGIC ---
const savedTheme = localStorage.getItem('vyos-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeSelect.value = savedTheme;

themeSelect.addEventListener('change', (e) => {
  const t = e.target.value;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('vyos-theme', t);
});

// filtros textuales por tabla (“Destination NAT” y “Source NAT”)
const natTextFilters = { 'Destination NAT': {}, 'Source NAT': {} };
// filtros IP/CIDR por tabla, mismos keys que en cols (ej: 'source.address', 'destination.address', 'translation.address')
const natIpFilters = { 'Destination NAT': {}, 'Source NAT': {} };


let sections = ['Firewall', 'NAT'];
let currentRulesetName = null;
let currentRulesetData = {};
let groupCache = {};
let showResolved = false;
let filters = {};                          // filtros de texto
let ipFilters = { source: null, destination: null }; // filtros IP/CIDR
// aquí almacenaremos el JSON completo de NAT para poder reenviarlo
// aquí almacenaremos el JSON completo de NAT para poder reenviarlo
let natData = null;
let CONFIG = null; // Global config object

// ========= CARGA DE FICHERO =========
uploadBtn.onclick = async () => {
  try {
    const file = fileInput.files[0];
    if (!file) return alert('Selecciona un fichero');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const j = await res.json();
    if (j.status !== 'ok') return alert(j.message);
    CONFIG = j.data; // Save config globally
    drawMenu();
    renderDashboard();
  } catch (e) { console.error(e); }
};

// ========= MENÚ DE SECCIONES =========
function drawMenu() {
  menu.innerHTML = sections
    .map(s => `<button class="btn" onclick="loadSection('${s}')">${s}</button>`)
    .join(' ');
}

// ========= CARGA DE SECCIÓN =========
async function loadSection(sec) {
  content.innerHTML = '<p>Cargando…</p>';
  if (sec === 'Firewall') return loadFirewall();
  if (sec === 'NAT') return loadNat();
  const res = await fetch(`/api/${sec}`);
  const data = await res.json();
  content.innerHTML = `<div class="card"><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
}


// ==== CARGAR NAT ====
async function loadNat() {
  content.innerHTML = '<p>Cargando NAT…</p>';
  const res = await fetch('/api/NAT');
  natData = await res.json();
  renderNat(natData);
}


// ==== RENDER NAT ====
function renderNat(nat) {
  // si no viene nada, aseguramos un objeto vacío
  nat = nat || {};
  const destRules = (nat.destination && nat.destination.rule) || {};
  const srcRules = (nat.source && nat.source.rule) || {};
  // Destination NAT
  renderNatTable('Destination NAT', nat.destination.rule, [
    { key: 'inbound-interface', label: 'In Interface' },
    { key: 'destination.address', label: 'Destino' },
    { key: 'translation.address', label: 'Traducción' },
    { key: 'exclude', label: 'Exclude' },
    { key: 'description', label: 'Descripción' }
  ]);

  // Source NAT
  renderNatTable('Source NAT', nat.source.rule, [
    { key: 'outbound-interface', label: 'Out Interface' },
    { key: 'source.address', label: 'Origen' },
    { key: 'translation.address', label: 'Traducción' },
    { key: 'exclude', label: 'Exclude' },
    { key: 'description', label: 'Descripción' }
  ]);

}

// helper genérico para sacar una propiedad anidada con “. ”
function get(obj, path) {
  const val = path.split('.').reduce((o, p) => (o != null ? o[p] : undefined), obj);

  if (val === undefined) return '-';

  // Flag “exclude”: Vuelo detectamos objeto vacío ⇒ true
  if (path === 'exclude' && typeof val === 'object') {
    return 'true';
  }

  // Traducción o cualquier campo anidado que venga como objeto {address:…}
  if (typeof val === 'object') {
    // por ejemplo { address: "10.0.0.1" }
    if ('address' in val) return val.address;
    // por ejemplo { name: "eth0" } (interfaces)
    if ('name' in val) return val.name;

    // si no, serializamos todo el objeto
    return JSON.stringify(val);
  }

  return String(val);
}

function renderNatTable(title, rules, cols) {
  // recupera filtros para esta tabla
  const txtF = natTextFilters[title];
  const ipF = natIpFilters[title];

  // CABECERA
  let html = `
    <div class="card">
    <div class="flex justify-between items-center mb-4">
      <h2>${title}</h2>
      <button class="btn" onclick="clearNatFilters('${title}')">Limpiar filtros</button>
    </div>
    <div class="table-container">
    <table>
      <thead><tr>
        <th>Rule</th>
        ${cols.map(c => {
    const isIp = c.key.endsWith('.address') || c.key === 'destination-interface' || c.key === 'source-interface';
    const currentVal = isIp
      ? (ipF[c.key] ? formatIPFilter(ipF[c.key]) : '')
      : (txtF[c.key] || '');

    return `<th>
                    <div class="flex flex-col gap-1">
                      <span>${c.label}</span>
                      <input 
                        type="text" 
                        class="filter-input" 
                        placeholder="Filter..." 
                        value="${currentVal}"
                        onchange="handleNatFilterChange('${title}', '${c.key}', this.value, ${isIp})"
                        onkeydown="if(event.key==='Enter') this.blur()"
                      />
                    </div>
                  </th>`;
  }).join('')}
      </tr></thead>
      <tbody>`;

  // FILTRADO y FILAS
  Object.entries(rules)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([id, r]) => {
      // chequeo filtros IP
      for (let key in ipF) {
        // extrae el objeto para matchIP: ‘source.address’ → r.source, etc.
        const root = key.split('.')[0];
        if (!matchIP(r[root], ipF[key])) return;
      }
      // chequeo filtros texto
      for (let key in txtF) {
        const cell = get(r, key);    // tu helper get() devuelve string
        if (!cell.includes(txtF[key])) return;
      }

      html += `<tr>
        <td>${id}</td>
        ${cols.map(c => `<td>${get(r, c.key)}</td>`).join('')}
      </tr>`;
    });

  html += `</tbody></table></div></div>`;
  content.insertAdjacentHTML('beforeend', html);
}

// Manejador de cambio en input de NAT
function handleNatFilterChange(title, key, val, isIp) {
  val = val.trim();
  if (isIp) {
    if (val) natIpFilters[title][key] = parseIPInput(val);
    else delete natIpFilters[title][key];
  } else {
    if (val) natTextFilters[title][key] = val;
    else delete natTextFilters[title][key];
  }
  // borra y vuelve a pintar TODO el NAT
  content.innerHTML = '';
  renderNat(natData);
}

// (Función setNatFilter eliminada, ya no se usa prompt)

// limpia todos los filtros de una tabla
function clearNatFilters(title) {
  natTextFilters[title] = {};
  natIpFilters[title] = {};
  content.innerHTML = '';
  renderNat(natData);
}



// ========= LISTA DE RULE‑SETS =========
async function loadFirewall() {
  const res = await fetch('/api/firewall/rulesets');
  const sets = await res.json();
  content.innerHTML = `<div class="card flex gap-2 flex-wrap">` + sets
    .map(rs => `<button class="btn" onclick="viewRuleset('${rs}')">${rs}</button>`)
    .join(' ') + `</div>`;
}

// ========= VER RULE-SET =========
async function viewRuleset(rs) {
  // 1) Traemos el ruleset del backend
  const res = await fetch(`/api/firewall/ruleset/${rs}`);
  const js = await res.json();

  currentRulesetName = rs;
  currentRulesetData = js.rule || {};

  // 2) --- precargar grupos --------------------------------------------
  //    Construimos un set de referencias "type|name" para
  //    address-group, network-group y port-group
  const refs = new Set();

  Object.values(currentRulesetData).forEach(r => {
    ['source', 'destination'].forEach(side => {
      const g = r[side]?.group;
      if (!g) return;

      // address-group
      if (g['address-group']) {
        let name = g['address-group'];
        if (name.startsWith('!')) name = name.slice(1);   // strip '!'
        refs.add(`address|${name}`);
      }

      // network-group
      if (g['network-group']) {
        let name = g['network-group'];
        if (name.startsWith('!')) name = name.slice(1);   // strip '!'
        refs.add(`network|${name}`);
      }

      // port-group (no negación en puertos)
      if (g['port-group']) {
        refs.add(`port|${g['port-group']}`);
      }
    });
  });

  // 3) Descargamos el contenido de cada grupo y lo guardamos en groupCache
  groupCache = {};   // limpia cache anterior
  await Promise.all([...refs].map(async ref => {
    const [type, name] = ref.split('|');
    const key = `${type}-${name}`;
    const r = await fetch(`/api/firewall/group/${type}/${name}`);
    const obj = await r.json();
    if (type === 'address') groupCache[key] = obj.address;
    if (type === 'network') groupCache[key] = obj.network;
    if (type === 'port') groupCache[key] = obj.port;
  }));

  // 4) Reset de filtros y render
  filters = {};
  ipFilters = { source: null, destination: null };
  showResolved = false;

  renderRuleset();
}

// ========= RENDER DE TABLA =========
function renderRuleset() {
  let html = `
    <div class="card">
    <div class="flex justify-between items-center mb-4">
      <h2>${currentRulesetName}</h2>
      <div class="flex gap-2">
        <button class="btn" id="toggleBtn">${showResolved ? 'Mostrar grupos' : 'Mostrar valores'}</button>
        <button class="btn primary" id="searchBtn">Buscar tráfico</button>
      </div>
    </div>
    <div id="searchResult" style="margin:8px 0;color:var(--accent-color);font-weight:bold;"></div>

    <div class="table-container">
    <table>
      <thead><tr>
  `;
  const cols = [
    { id: 'rule_id', label: 'rule_id' },
    { id: 'source', label: 'source' },
    { id: 'src_port', label: 'source port' },
    { id: 'destination', label: 'destination' },
    { id: 'dst_port', label: 'destination port' },
    { id: 'protocol', label: 'protocol' },
    { id: 'action', label: 'action' },
    { id: 'description', label: 'description' }
  ];

  cols.forEach(c => {
    const isIP = (c.id === 'source' || c.id === 'destination');
    const currentVal = isIP
      ? (ipFilters[c.id] ? formatIPFilter(ipFilters[c.id]) : '')
      : (filters[c.id] || '');

    html += `<th class="col-${c.id}">
               <div class="flex flex-col gap-1">
                 <span>${c.label}</span>
                 <input 
                    type="text" 
                    class="filter-input" 
                    placeholder="Filter..." 
                    value="${currentVal}"
                    onchange="handleFilterChange('${c.id}', this.value)"
                    onkeydown="if(event.key==='Enter') this.blur()"
                 />
               </div>
             </th>`;
  });
  html += `</tr></thead><tbody>`;

  // -------- filas -----------
  Object.entries(currentRulesetData)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([id, r]) => {
      // filtrar por IP
      if (ipFilters.source && !matchIP(r.source, ipFilters.source)) return;
      if (ipFilters.destination && !matchIP(r.destination, ipFilters.destination)) return;

      const row = {
        rule_id: id,
        source: entityText(r.source, 'address', 'network'),
        src_port: portText(r.source),
        destination: entityText(r.destination, 'address', 'network'),
        dst_port: portText(r.destination),
        protocol: r.protocol || '-',
        action: r.action,
        description: r.description || '-'
      };
      // filtros textuales
      //for (let k in filters) if (!row[k].includes(filters[k])) return;
      for (let k in filters) {
        // si es filtro de puerto, usar matchPort en lugar de includes
        if (k === 'src_port' || k === 'dst_port') {
          const spec = filters[k];                 // e.g. "80" o "1-100" o "80,443"
          const side = k === 'src_port'
            ? r.source
            : r.destination;
          if (!matchPort(side, spec)) return;     // aquí entra tu lógica de rango/listas
        }
        else {
          // resto de filtros (texto / IP)
          if (!row[k].includes(filters[k])) return;
        }
      }


      html += `<tr id="row-${id}">
        <td class="col-rule_id">${row.rule_id}</td>
        <td class="col-source">${cellHTML(r.source, 'address', 'network')}</td>
        <td class="col-src_port">${cellHTML(r.source, 'port')}</td>
        <td class="col-destination">${cellHTML(r.destination, 'address', 'network')}</td>
        <td class="col-dst_port">${cellHTML(r.destination, 'port')}</td>
        <td class="col-protocol">${row.protocol}</td>
        <td class="col-action">${row.action}</td>
        <td class="col-description">${row.description}</td>
      </tr>`;
    });

  html += `</tbody></table></div></div>`;
  content.innerHTML = html;

  document.getElementById('toggleBtn').onclick = () => { showResolved = !showResolved; renderRuleset(); };
  document.getElementById('searchBtn').onclick = openSearchModal;
}

// ========= FILTROS DE CABECERA (INPUT) =========
function handleFilterChange(field, val) {
  val = val.trim();
  if (field === 'source' || field === 'destination') {
    // eliminar posible filtro textual obsoleto
    delete filters[field];
    ipFilters[field] = val ? parseIPInput(val) : null;
  } else {
    if (val) filters[field] = val;
    else delete filters[field];
  }
  renderRuleset();
}

// ========= UTILIDADES DE IP =========
function parseIPInput(v) {
  let [ip, mask] = v.split('/');
  mask = mask ? parseInt(mask) : 32;
  const [net, mlen] = parseCIDR(`${ip}/${mask}`);
  return { ip: ipToInt(ip), net, mask: mlen };
}

function formatIPFilter(info) {
  if (!info) return '';
  const o1 = (info.ip >>> 24) & 255, o2 = (info.ip >>> 16) & 255, o3 = (info.ip >>> 8) & 255, o4 = info.ip & 255;
  return `${o1}.${o2}.${o3}.${o4}/${info.mask}`;
}

// ========= TEXTO Y CELDAS =========
function entityText(obj, aKey, nKey) {
  if (!obj) return '-';
  if (obj.group) {
    const type = obj.group['address-group'] ? aKey : nKey;
    let name = obj.group[`${type}-group`];
    const neg = name.startsWith('!');
    if (neg) name = name.slice(1);                // <— quita !
    const key = `${type}-${name}`;
    const vals = groupCache[key];
    if (showResolved) {
      const txt = Array.isArray(vals) ? vals.join(', ') : String(vals);
      return neg ? `!(${txt})` : txt;             // marca negado
    }
    return obj.group[`${type}-group`];            // conserva “!” en la vista de grupos
  }
  return obj.address || '-';
}


function portText(obj) {
  if (!obj) return '-';
  if (obj.group && obj.group['port-group']) {
    const n = obj.group['port-group'];
    return showResolved
      ? (Array.isArray(groupCache[`port-${n}`]) ? groupCache[`port-${n}`].join(', ') : groupCache[`port-${n}`])
      : n;
  }
  if (obj.port) return Array.isArray(obj.port) ? obj.port.join(', ') : String(obj.port);
  return '-';
}
function cellHTML(obj, aKey, nKey) {
  if (!obj) return '-';
  // address/network
  if (arguments.length === 3) {
    if (obj.group) {
      const type = obj.group['address-group'] ? aKey : nKey, name = obj.group[`${type}-group`];
      return showResolved
        ? entityText(obj, aKey, nKey)
        : `<a href="#" onclick="showGroup('${type}','${name}');return false;">${name}</a>`;
    }
    return obj.address || '-';
  }
  // port
  if (obj.group && obj.group['port-group']) {
    const name = obj.group['port-group'];
    return showResolved
      ? portText(obj)
      : `<a href="#" onclick="showGroup('port','${name}');return false;">${name}</a>`;
  }
  if (obj.port) return portText(obj);
  return '-';
}

// ========= BUSCADOR DE TRÁFICO (sin cambios) =========
function openSearchModal() {
  const html = `
    <div class="modal">
      <div class="modal-content">
        <h3>Buscar tráfico</h3>
        <label>Source IP: <input id="s_ip" placeholder="10.0.0.5/32 or 10.0.0.0/24" /></label><br />
        <label>Source Port: <input id="s_port" placeholder="e.g. 80" /></label><br />
        <label>Destination IP: <input id="d_ip" placeholder="10.0.0.10/32" /></label><br />
        <label>Destination Port: <input id="d_port" placeholder="e.g. 443" /></label><br />
        <label>Protocol: <input id="proto" placeholder="tcp, udp, icmp" /></label><br /><br />
        <div class="flex gap-2">
          <button class="btn primary" id="execSearch">Buscar</button>
          <button class="btn" onclick="closeModal()">Cancelar</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('execSearch').onclick = executeSearch;
}
function closeModal() { document.querySelector('.modal')?.remove(); }
// Ejecutar búsqueda
function executeSearch() {
  const sip = document.getElementById('s_ip').value.trim() || 'any';
  const dip = document.getElementById('d_ip').value.trim() || 'any';
  const sp = document.getElementById('s_port').value.trim() || 'any';
  const dp = document.getElementById('d_port').value.trim() || 'any';
  let proto = document.getElementById('proto').value.trim().toLowerCase() || 'any';
  if (!['any', 'tcp', 'udp', 'icmp'].includes(proto)) proto = 'any';
  closeModal();
  const matchId = findMatchingRule({ srcIP: sip, dstIP: dip, srcPort: sp, dstPort: dp, protocol: proto });
  const resDiv = document.getElementById('searchResult');
  if (!matchId) {
    resDiv.textContent = 'No hay regla que haga match.';
    return;
  }
  resDiv.innerHTML = `Coincide regla <b>${matchId}</b> <button class="btn" onclick="gotoRule('${matchId}')">Go to</button>`;
}

function gotoRule(id) {
  document.querySelectorAll('tr').forEach(r => r.classList.remove('highlight'));
  const row = document.getElementById(`row-${id}`);
  if (row) {
    row.classList.add('highlight');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}


// ========= MATCHERS (sin cambios salvo matchPort actualizado) =========
function findMatchingRule(c) {
  const s = parseIPInput(c.srcIP);
  const d = parseIPInput(c.dstIP);
  for (const [id, r] of Object.entries(currentRulesetData).sort((a, b) => a[0] - b[0])) {
    if (matchRule(r, s, d, c.srcPort, c.dstPort, c.protocol)) {
      return id;
    }
  }
  return null;
}
/* ---------- regla completa ---------- */
function matchRule(r, sip, dip, sp, dp, pr) {
  return matchIP(r.source, sip) &&
    matchIP(r.destination, dip) &&
    matchPort(r.source, sp) &&
    matchPort(r.destination, dp) &&
    matchProtocol(r.protocol, pr);
}

/* ---------- MATCH IP (con soporte de “!grupo”) ---------- */
function matchIP(obj, info) {
  // Sin filtro o sin dato en la regla ⇒ coincide
  if (!info || !obj) return true;

  /* ------------------------------------------------------------------
     1. Address-group o Network-group
     ------------------------------------------------------------------ */
  if (obj.group) {
    // --- address-group ----------------------------------------------
    if (obj.group['address-group']) {
      let name = obj.group['address-group'];
      const neg = name.startsWith('!');
      if (neg) name = name.slice(1);                 // quitamos ‘!’
      const list = wrap(groupCache[`address-${name}`]);
      const hit = list.some(spec => ipInSpec(info.ip, spec));
      return neg ? !hit : hit;
    }

    // --- network-group ----------------------------------------------
    if (obj.group['network-group']) {
      let name = obj.group['network-group'];
      const neg = name.startsWith('!');
      if (neg) name = name.slice(1);
      const list = wrap(groupCache[`network-${name}`]);
      const hit = list.some(spec => ipInSpec(info.ip, spec));
      return neg ? !hit : hit;
    }
  }

  /* ------------------------------------------------------------------
     2. Dirección directa en la regla
     ------------------------------------------------------------------ */
  if (obj.address) {
    return ipInSpec(info.ip, obj.address);
  }

  /* ------------------------------------------------------------------
     3. Sin restricción explícita ⇒ coincide
     ------------------------------------------------------------------ */
  return true;
}

/* ---------- ayuda genérica ---------- */
function wrap(x) {
  if (x === undefined || x === null) return [];  // evita undefined->includes
  return Array.isArray(x) ? x : [x];
}

/* ---------- IP utils ---------- */

function parseCIDR(c) {
  const [ip, maskStr] = c.split('/');
  const mask = parseInt(maskStr);
  const ipn = ipToInt(ip);
  const maskBits = mask === 0 ? 0 : (~((1 << (32 - mask)) - 1) >>> 0);
  return [ipn & maskBits, mask];
}


function ipToInt(ip) {
  return ip.split('.').reduce((a, b) => a * 256 + parseInt(b), 0);
}


function ipInSpec(ipn, spec) {
  /* lista separada por comas ---------------------------------- */
  //spec = String(spec).trim();
  if (spec.includes(',')) {
    return spec.split(',').some(s => ipInSpec(ipn, s.trim()));
  }
  /* formato CIDR ---------------------------------------------- */
  if (spec.includes('/')) {
    const [net, mask] = parseCIDR(spec);
    const maskBits = mask === 0 ? 0 : (~((1 << (32 - mask)) - 1) >>> 0);
    return (ipn & maskBits) === net;
  }
  /* rango a-b -------------------------------------------------- */
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map(ipToInt);
    return ipn >= a && ipn <= b;
  }
  /* host único ------------------------------------------------- */
  return ipn === ipToInt(spec);
}

/* ---------- PUERTO utils ---------- */
function portInSpec(pin, spec) {
  /* lista “80,443,8080” --------------------------------------- */
  // spec = String(spec).trim();
  spec = String(spec).trim();
  if (spec.includes(',')) {
    return spec.split(',').some(p => portInSpec(pin, p.trim()));
  }
  /* rango “2000-3000” ----------------------------------------- */
  if (spec.includes('-')) {
    const [a, b] = spec.split('-').map(Number);
    return pin >= a && pin <= b;
  }
  /* puerto único ---------------------------------------------- */
  return pin === Number(spec);
}

function matchPort(obj, portIn) {
  // 1) “any” casa con TODO
  if (portIn === 'any') return true;

  // 2) la regla no tiene ni source ni destination => no está limitando
  if (!obj) return false;

  // 3) ya podemos parsear
  const pin = parseInt(portIn, 10);
  let specs = [];

  // 4) cargar specs de port‑group o puerto suelto
  if (obj.group && obj.group['port-group']) {
    specs.push(...wrap(groupCache[`port-${obj.group['port-group']}`] || []));
  }
  else if (obj.port) {
    specs.push(...wrap(obj.port));
  }

  // 5) sin specs = sin puerto definido ⇒ no match
  if (!specs.length) return false;

  // 6) probar cada spec
  return specs.some(s => portInSpec(pin, s));
}

/* ---------- PROTOCOLO ---------- */
function matchProtocol(ruleProto, searchProto) {
  if (!searchProto || searchProto === 'any') return true;
  if (!ruleProto || ruleProto === 'any' || ruleProto === 'all') return true;

  const rp = ruleProto.toLowerCase();
  const sp = searchProto.toLowerCase();

  /* reglas con tcp_udp ---------------------------------------- */
  if (rp.includes('_')) {
    return rp.split('_').includes(sp);
  }
  return rp === sp;
}

// ========= MODAL DE GRUPOS =========
async function showGroup(type, name) {
  const realName = name.startsWith('!') ? name.slice(1) : name;
  const res = await fetch(`/api/firewall/group/${type}/${realName}`);
  const grp = await res.json();

  let list;
  if (type === 'address') list = grp.address;
  if (type === 'network') list = grp.network;
  if (type === 'port') list = grp.port;

  const items = Array.isArray(list) ? list : [list];
  const html = `
    <div class="modal"><div class="modal-content">
      <h3>${name}</h3>
      <ul>${items.map(i => `<li>${i ?? '-'}</li>`).join('')}</ul>
      <button class="btn" onclick="closeModal()">Cerrar</button>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ——————————————————————————————
//  NUEVA FUNCIÓN: Conectar por SSH y bajar config
// ——————————————————————————————

document.getElementById('fetchBtn').onclick = openFetchModal;

function openFetchModal() {
  const html = `
    <div class="modal">
      <div class="modal-content">
        <h3>Fetch config via SSH</h3>
        <label>Host / FQDN:
          <input id="fw_host" placeholder="10.0.0.5" />
        </label><br/>
        <label>Puerto SSH:
          <input id="fw_port" placeholder="22" value="22" />
        </label><br/>
        <label>Usuario (default vyos):
          <input id="fw_user" placeholder="vyos" />
        </label><br/>
        <label>Password (opcional):
          <input id="fw_pass" type="password" />
        </label><br/><br/>
        <button class="btn primary" id="doFetch">Conectar</button>
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <div id="fetchError" style="color:red;margin-top:8px;"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('doFetch').onclick = doFetchConfig;
}

async function doFetchConfig() {
  const host = document.getElementById('fw_host').value.trim();
  const port = parseInt(document.getElementById('fw_port').value, 10) || 22;
  const user = document.getElementById('fw_user').value.trim() || 'vyos';
  const pass = document.getElementById('fw_pass').value;

  if (!host) {
    return document.getElementById('fetchError').textContent =
      'El host es obligatorio';
  }

  // Mostrar spinner / deshabilitar botón
  const btn = document.getElementById('doFetch');
  btn.disabled = true;
  btn.textContent = 'Conectando…';

  try {
    const res = await fetch('/fetch-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, user, password: pass || null })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Error desconocido');

    // OK: tenemos JSON limpio de config
    closeModal();
    // Simular upload: recargamos menu y datos
    CONFIG = j.data;              // Save config globally
    drawMenu();              // inicializa la vista
    renderDashboard();
  }
  catch (e) {
    document.getElementById('fetchError').textContent = e.message;
  }
  finally {
    btn.disabled = false;
    btn.textContent = 'Conectar';
  }
}

// ========= DASHBOARD CHARTS =========
function renderDashboard() {
  if (!CONFIG) return;

  // 1. Calculate Stats
  // Firewall: Rules per ruleset
  const fwStats = {};
  const fwRulesets = (CONFIG.firewall && CONFIG.firewall.name) ? CONFIG.firewall.name : {};

  // Debug log
  console.log('Dashboard Data:', { fwRulesets, nat: CONFIG.nat });

  for (const [name, data] of Object.entries(fwRulesets)) {
    // Handle case where 'rule' might be missing or not an object
    let count = 0;
    if (data && data.rule) {
      count = Object.keys(data.rule).length;
    }
    fwStats[name] = count;
  }

  // NAT: Source vs Destination count
  let snatCount = 0;
  let dnatCount = 0;
  if (CONFIG.nat) {
    if (CONFIG.nat.source && CONFIG.nat.source.rule) {
      snatCount = Object.keys(CONFIG.nat.source.rule).length;
    }
    if (CONFIG.nat.destination && CONFIG.nat.destination.rule) {
      dnatCount = Object.keys(CONFIG.nat.destination.rule).length;
    }
  }

  // Check if we have data
  const hasFwData = Object.keys(fwStats).length > 0;
  const hasNatData = snatCount > 0 || dnatCount > 0;

  // 2. Render HTML
  const html = `
    <div class="dashboard-grid">
      <div class="chart-container">
        <h3>Firewall Rules per Ruleset</h3>
        ${hasFwData ? '<canvas id="fwChart"></canvas>' : '<p style="text-align:center;margin-top:2rem;color:var(--text-secondary)">No firewall rules found</p>'}
      </div>
      <div class="chart-container">
        <h3>NAT Rules Distribution</h3>
        ${hasNatData ? '<canvas id="natChart"></canvas>' : '<p style="text-align:center;margin-top:2rem;color:var(--text-secondary)">No NAT rules found</p>'}
      </div>
    </div>
  `;
  content.innerHTML = html;

  // 3. Render Charts (only if data exists)
  // Theme colors
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const isRetro = document.documentElement.getAttribute('data-theme') === 'retro';

  const textColor = isRetro ? '#00ff41' : (isDark ? '#f9fafb' : '#1f2937');
  const gridColor = isRetro ? '#003300' : (isDark ? '#374151' : '#e5e7eb');
  const barColor = isRetro ? '#00ff41' : '#3b82f6';

  if (hasFwData) {
    new Chart(document.getElementById('fwChart'), {
      type: 'bar',
      data: {
        labels: Object.keys(fwStats),
        datasets: [{
          label: 'Number of Rules',
          data: Object.values(fwStats),
          backgroundColor: barColor,
          borderColor: barColor,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          x: {
            grid: { display: false },
            ticks: { color: textColor }
          }
        }
      }
    });
  }

  if (hasNatData) {
    new Chart(document.getElementById('natChart'), {
      type: 'doughnut',
      data: {
        labels: ['Source NAT', 'Destination NAT'],
        datasets: [{
          data: [snatCount, dnatCount],
          backgroundColor: isRetro ? ['#00ff41', '#008f11'] : ['#10b981', '#f59e0b'],
          borderColor: isRetro ? '#000' : '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } }
        }
      }
    });
  }
}
