const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const { checkBooking, confirmationText, gbp } = Engine;
const clone = (o) => JSON.parse(JSON.stringify(o));
const RULES = [
  ['R-01', 'HS code has at least 6 digits', 'Red', 'Customs rejects shorter codes. Every item line needs one.'],
  ['R-02', 'Declared value matches the items', 'Red', 'Total declared value must equal the sum of quantity × unit price, within 1%.'],
  ['R-03', 'Units per carton × cartons equals quantity', 'Red', 'Checked for every item line.'],
  ['R-04', 'Booking cartons equal the item cartons', 'Red', 'The booking total must equal the sum of the item cartons.'],
  ['R-05', 'Weight per pallet fits a carrier limit', 'Red', 'Gross weight ÷ pallets must be within the limit of at least one carrier (400, 500 or 750 kg). If none fits, we show how many pallets each carrier would need.'],
  ['R-06', 'No lithium, aerosol or flammable goods', 'Red', 'Scanned in item descriptions. Negations such as “battery-free” pass; vague wording is raised as a note, not a block.'],
  ['R-07', 'Gross weight covers the items', 'Amber', 'Gross weight must be at least the sum of unit weight × quantity.'],
  ['R-08', 'Warehouse delivery has an appointment', 'Amber', 'Warehouses reject deliveries without a booked slot.'],
  ['R-09', 'Every item has a country of origin', 'Amber', 'Missing origin delays customs clearance.'],
  ['R-10', 'Ready date is today or later', 'Amber', 'Today is fine; a date in the past is not.'],
];
const RULE_NAME = Object.fromEntries(RULES.map((r) => [r[0], r[1]]));
let CARRIERS = [];
const carriersReady = fetch('carriers.json').then((r) => r.json()).then((j) => { CARRIERS = j.carriers; }).catch(() => { CARRIERS = []; });

/* ---------- mode ---------- */
function setMode(n) {
  $('#a1').hidden = n !== 1; $('#s1').hidden = n !== 1; $('#a2').hidden = n !== 2; $('#s2').hidden = n !== 2;
  $('#m1').setAttribute('aria-selected', n === 1); $('#m2').setAttribute('aria-selected', n === 2);
  try { history.replaceState(null, '', n === 2 ? '#upload' : location.pathname + location.search); } catch (e) { /* sandboxed frame */ }
}
$('#m1').onclick = () => setMode(1); $('#m2').onclick = () => setMode(2);

/* ---------- report ---------- */
const prioButtons = (cur) => ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'].map((p) => `<button type="button" data-prio="${p}" aria-pressed="${(cur || 'Balanced') === p}">${p}</button>`).join('');
const svc = (s) => { const t = String(s).replace(/^Road /, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const VAR = { Red: 'red', Amber: 'amb', Green: 'grn' };
const segs = (res, n) => `<div class="segs" role="group" aria-label="${n} of 10 checks passed">${RULES.map(([id, name]) => { const bad = res.findings.some((f) => f.rule === id); return `<button type="button" class="${bad ? 'x' : ''}" data-rule="${id}" title="${id}: ${esc(name)} (${bad ? 'failed' : 'passed'})" aria-label="${id} ${bad ? 'failed' : 'passed'}"></button>`; }).join('')}<span class="cap">${n} of 10 checks passed</span></div>`;
const longDate = (d) => (d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'n/a');
const PILL = { have: ['We have it', 'ok'], check: ['Check it', 'amb'], add: ['You add', 'mut'] };
function findingCard(f, reg) {
  const why = (RULES.find((r) => r[0] === f.rule) || [])[3] || '';
  return `<div class="find ${f.severity}"><div class="fh"><i class="sev" aria-hidden="true"></i><b>${esc(f.title || RULE_NAME[f.rule] || f.rule)}</b><span class="tagc">${f.rule}</span>${f.item ? `<span class="tagc">${esc(f.item)}</span>` : ''}</div><p>${esc(f.message)}</p><div class="hf"><b>${f.severity === 'Info' ? 'Suggested' : 'How to fix'}:</b> ${esc(f.fix)}</div><div class="fa">${f.action ? `<button class="btn pri sm" type="button" data-act="${reg(f.action)}">${f.severity === 'Info' ? 'Apply' : 'Fix it'}: ${esc(f.action.label)}</button>` : ''}<button class="lk" type="button" data-why aria-expanded="false">Why it matters</button></div><p class="why" hidden>${esc(why)}</p></div>`;
}
function checksStrip(res) {
  return `<div class="chk">${RULES.map(([id, name]) => { const fs = res.findings.filter((f) => f.rule === id), st = fs.some((f) => f.severity === 'Red') ? 'Red' : fs.length ? 'Amber' : 'Green';
    return `<button type="button" class="${st}" data-rule="${id}"><i></i><span><b>${id}</b> ${esc(name)}</span></button>`; }).join('')}</div>`;
}
function carriersBlock(b, res, reg) {
  if (!res.options.length) return '<p class="mut">No carrier on the rate card serves this route.</p>';
  const wpp = res.totals.weightPerPallet, pal = Number(b.pallets), maxT = Math.max(...res.options.map((o) => o.total || 0)) || 1;
  let h = `<p class="sub">${wpp != null ? `Load: ${b.grossWeight} kg on ${plural(pal, 'pallet')} = ${wpp} kg per pallet. ` : ''}Carriers A, B and C on the rate card, with the reason for each.</p><div class="tw"><table class="ctab"><thead><tr><th>Carrier</th><th>Total</th><th>Transit</th><th>Arrives</th><th>On time</th></tr></thead><tbody>${res.options.map((o) => {
    const tag = o.isPick ? ' <span class="pill pk">Our pick</span>' : !o.feasible ? ' <span class="pill amb">Too heavy</span>' : '';
    return `<tr class="${o.isPick ? 'pk' : o.feasible ? '' : 'no'}"><td><span class="nm">${esc(o.carrier)}<small>${esc(svc(o.service))} · max ${o.maxWeightPerPallet} kg a pallet</small></span>${tag}</td><td><span class="big num">${gbp(o.total)}</span><span class="meter" aria-hidden="true"><i style="width:${Math.round(((o.total || 0) / maxT) * 100)}%"></i></span><small class="mut">${gbp(o.pricePerPallet)} per pallet</small></td><td><span class="big num">${o.transitDays}</span> <span class="mut">working days</span></td><td class="num">${longDate(o.eta)}</td><td><span class="big num">${o.onTime}%</span><span class="meter" aria-hidden="true"><i style="width:${o.onTime}%"></i></span></td></tr><tr class="vd"><td colspan="5">${esc(o.verdict)}</td></tr>`; }).join('')}</tbody></table></div>`;
  if (res.palletPlan) h += `<div class="h3">Pallet plan: what it takes to fit</div><div class="tw"><table class="pplan"><thead><tr><th>Carrier</th><th>Pallets needed</th><th>Per pallet</th><th>New total</th><th></th></tr></thead><tbody>${res.palletPlan.rows.map((r) => {
    const pick = res.palletPlan.pick === `${r.carrier} ${r.service}`; return `<tr class="${pick ? 'rec' : ''}"><td>${esc(r.carrier)} · ${esc(r.service)}${pick ? ' <span class="pill pk">Best fix</span>' : ''}</td><td>${r.palletsNeeded}</td><td>${r.kgPerPallet} kg</td><td>${gbp(r.newTotal)}</td><td><button class="btn sm" type="button" data-act="${reg({ type: 'setPallets', value: r.palletsNeeded, label: `Use ${r.palletsNeeded} pallets` })}">Use ${r.palletsNeeded} pallets</button></td></tr>`; }).join('')}</tbody></table></div>`;
  return h;
}
function datesBlock(b, res) {
  const rec = res.recommendation; if (!rec || !rec.etaDate) return '';
  const hol = Engine.holidaysFor(b.originCountry, b.destCountry), parsed = Engine.parseDate(b.readyDate), n0 = new Date(), today = new Date(Date.UTC(n0.getFullYear(), n0.getMonth(), n0.getDate()));
  const start = parsed && parsed >= today ? parsed : today, end = new Date(rec.etaDate + 'T00:00:00Z'), cells = [];
  let counted = 0;
  for (let d = new Date(start), guard = 0; d <= end && guard < 40; d = new Date(d.getTime() + 864e5), guard++) {
    const iso = d.toISOString().slice(0, 10), dow = d.getUTCDay(), isEnd = d.getTime() === end.getTime(), first = d.getTime() === start.getTime();
    let cls = 'w', note = '';
    if (first) { cls = 'c'; note = 'Collect'; } else if (isEnd) { cls = 'd'; note = 'Delivery'; counted++; }
    else if (dow === 0 || dow === 6) { cls = 'e'; note = 'Weekend'; } else if (hol[iso]) { cls = 'h'; note = 'Holiday'; } else { counted++; note = 'Day ' + counted; }
    if (first && (dow === 0 || dow === 6)) note = 'Collect';
    cells.push(`<li class="${cls}"${hol[iso] ? ` title="${esc(hol[iso])}"` : ''}><small>${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</small><b>${d.getUTCDate()}</b><em>${note}</em></li>`);
  }
  const sk = rec.skipped && rec.skipped.length ? ` Holidays skipped: ${rec.skipped.map((s) => `${s.name} (${s.date})`).join(', ')}.` : '';
  return `<ol class="days" aria-label="Days from collection to delivery">${cells.join('')}</ol><p class="sub">Collection ${esc(b.readyDate)} from ${esc(b.originCity)}, delivery around <b>${esc(rec.eta)}</b> in ${esc(b.destCity)}. Estimate = ready date plus ${rec.transitDays} working days (Monday to Friday), skipping UK and ${esc(b.destCountry)} public holidays.${esc(sk)} Provisional until the problems above are fixed.</p>`;
}
function paperworkBlock(b, res) {
  const p = Engine.paperwork(b, res);
  return `<details class="pw" open><summary><span>Export invoice checklist</span><span class="sm mut">${p.counts.have} ready · ${p.counts.check} to check · ${p.counts.add} for you to add</span></summary><div>
  <div class="acts" style="margin-top:0"><button class="btn sm" type="button" data-inv>Download draft invoice (.xlsx)</button></div>
  ${p.invoice.map((x) => `<div class="inv"><span class="n">${x.n}</span><span><b>${esc(x.title)}</b><small>${esc(x.detail)} ${esc(x.note)}</small></span><span class="pill ${PILL[x.status][1]}">${PILL[x.status][0]}</span></div>`).join('')}
  <p class="sub" style="margin:10px 0 0">Source: ${p.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(', ')}. The draft invoice leaves anything we do not hold blank.</p></div></details>
  <details class="pw"><summary><span>Rules for UK to ${esc(b.destCountry)}</span><span class="sm mut">reference only</span></summary><div><div class="h3" style="margin-top:4px">Leaving the UK (export)</div><ul class="rl">${p.exportRules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="h3">Entering ${esc(b.destCountry)} (import)</div><ul class="rl">${p.importRules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="sub" style="margin:10px 0 0">Your buyer or customs agent can confirm product-specific rules.</p></div></details>`;
}
function nextSteps(b, res) {
  const reds = res.findings.filter((f) => f.severity === 'Red').length, rec = res.recommendation;
  const first = reds ? [`Fix the ${plural(reds, 'problem')} above (the Fix it buttons do it in one click where the answer is certain).`, 'Check again. Nothing is booked until nothing is red.'] : [res.status === 'Amber' ? 'Review the warnings. They will not stop the shipment but can delay it.' : 'Nothing to fix.', 'Confirm the booking.'];
  return `<ol>${[...first, 'Prepare the commercial invoice (see the checklist above) and confirm both EORI numbers: yours (GB) and the importer’s (EU).', `Label every box with the booking reference and “box x of ${b.cartons}” so the count matches what is declared.`,
    rec ? `Tell the receiver: delivery is expected around ${rec.eta}. Check their opening hours${/warehouse/i.test(b.destType || '') ? ' and the delivery slot' : ''}.` : 'Tell the receiver once a carrier is chosen.', `Hand over on ${b.readyDate}: ${plural(Number(b.pallets), 'pallet')} wrapped and labelled, invoice and packing list ready at ${b.originCity}.`].map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
}
function summaryText(b, res) {
  const L = [`Pre-Flight: ${b.id || 'Booking'} (${Engine.PLAIN[res.status]})`, `${b.originCity} to ${b.destCity}, ${b.pallets} pallet(s), ${b.grossWeight} kg, ready ${b.readyDate}`, res.headline];
  res.findings.forEach((f) => L.push(`- ${f.rule} ${f.severity}: ${f.message} Fix: ${f.fix}`));
  if (res.recommendation) L.push(`Recommended: ${res.recommendation.carrier} ${res.recommendation.service}, ${gbp(res.recommendation.total)}, arrives ${res.recommendation.eta}`);
  return L.join('\n');
}
function report(b, res, o = {}) {
  const key = 'r' + Math.random().toString(36).slice(2, 8), acts = [], reg = (a) => acts.push(a) - 1;
  window.__rep = window.__rep || {}; window.__rep[key] = { b, res, acts };
  const reds = res.findings.filter((f) => f.severity === 'Red'), ambers = res.findings.filter((f) => f.severity === 'Amber'), rec = res.recommendation, passed = Engine.passedCount(res);
  const sub = reds.length ? `${plural(reds.length, 'problem')} to fix before this can leave` : ambers.length ? `${plural(ambers.length, 'warning')} could cause delays` : 'Nothing to fix';
  const group = (title, note, list) => (list.length ? `<div class="h3">${title} · ${list.length}</div><p class="sub">${note}</p>${list.map((f) => findingCard(f, reg)).join('')}` : '');
  const maxLimit = Math.max(0, ...res.options.map((o) => o.maxWeightPerPallet || 0)), wpp = res.totals.weightPerPallet;
  const pick = rec
    ? `<div class="why-pick"><div class="eyebrow">Our pick · ${esc(b.priority || 'Balanced')}</div><div class="pk">${esc(rec.carrier)} · ${esc(svc(rec.service))}</div><p>${esc(rec.reason)}</p></div><dl class="tri"><div><dt>Cost</dt><dd class="num">${gbp(rec.total)}</dd></div><div><dt>Arrives</dt><dd class="num">${esc(rec.eta || 'n/a')}</dd></div><div><dt>On time</dt><dd class="num">${rec.onTime}%</dd></div></dl>`
    : `<div class="why-pick"><div class="eyebrow">Our pick</div><div class="pk">No carrier fits yet</div><p>${wpp != null ? `${wpp} kg per pallet is above every carrier’s limit. ` : ''}The pallet plan below shows what would work.</p></div><dl class="tri"><div><dt>Per pallet</dt><dd class="num">${wpp != null ? wpp + ' kg' : 'n/a'}</dd></div><div><dt>Highest limit</dt><dd class="num">${maxLimit ? maxLimit + ' kg' : 'n/a'}</dd></div><div><dt>Over by</dt><dd class="num">${wpp != null && maxLimit ? Math.max(0, Math.round(wpp - maxLimit)) + ' kg' : 'n/a'}</dd></div></dl>`;
  const route = [b.originCity && b.destCity ? `${b.originCity} to ${b.destCity}` : '', b.pallets ? plural(Number(b.pallets), 'pallet') : '', b.grossWeight ? `${b.grossWeight} kg` : ''].filter(Boolean).join(' · ');
  return `<div class="rep${o.still ? ' still' : ''}" data-rep="${key}">
  ${o.live ? `<div class="whatif"><span class="t">Try a change</span><div class="seg" role="group" aria-label="Priority">${prioButtons(b.priority)}</div><span class="step"><button type="button" data-pal="-1" aria-label="One pallet fewer">−</button><span>${b.pallets} pallet${+b.pallets === 1 ? '' : 's'}</span><button type="button" data-pal="1" aria-label="One more pallet">+</button></span></div>` : ''}
  ${o.change ? `<div class="change">${esc(o.change)}</div>` : ''}
  <div class="top2"><div class="vcard ${res.status}"><div class="who">${esc(b.id || 'Booking')}${route ? ' · ' + esc(route) : ''}</div><div class="vl">${esc(Engine.PLAIN[res.status])}</div><p>${sub}.</p>${segs(res, passed)}</div>
  <div class="pcard">${pick}</div></div>
  ${group('Must fix', 'These stop the shipment.', reds)}${group('Worth fixing', 'These will not stop it but can cause delays.', ambers)}${group('Notes', 'For your information. They never change the status.', res.advisories)}
  ${res.findings.length || res.advisories.length ? '' : '<div class="h3">What we found</div><p class="sub">All ten checks passed. Nothing to fix.</p>'}
  <div class="h3">The 10 checks</div><p class="sub">Tap a check to read the rule. The ten squares at the top show the same result at a glance.</p>${checksStrip(res)}
  <div class="h3">Carriers compared</div>${carriersBlock(b, res, reg)}
  <div class="h3">Dates</div>${datesBlock(b, res) || '<p class="sub">Dates appear once a carrier fits.</p>'}
  <div class="h3">Paperwork</div>${paperworkBlock(b, res)}
  <div class="h3 next">What happens next</div><div class="next"><p>${esc(confirmationText(b, res))}</p>${nextSteps(b, res)}</div>
  <div class="acts">${res.status === 'Red' ? `<button class="btn pri" type="button" disabled>Fix ${plural(reds.length, 'problem')} to book</button>` : '<button class="btn pri" type="button" data-confirm>Confirm booking</button>'}
  <a class="btn" href="mailto:?subject=${encodeURIComponent(`Pre-Flight: ${b.id || 'booking'} needs attention (${Engine.PLAIN[res.status]})`)}&body=${encodeURIComponent(summaryText(b, res))}">Escalate to a colleague</a><button class="btn" type="button" data-copy>Copy summary</button><button class="btn" type="button" data-print>Print or save as PDF</button></div>
  <div data-conf></div></div>`;
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,a'); if (!t) return;
  const root = t.closest('[data-rep]'), ctx = root && window.__rep[root.dataset.rep];
  if (t.dataset.rule) return openRules(t.dataset.rule);
  if (t.hasAttribute('data-print')) return window.print();
  if (t.hasAttribute('data-why')) { const p = t.closest('.find').querySelector('.why'); p.hidden = !p.hidden; t.setAttribute('aria-expanded', String(!p.hidden)); return; }
  if (t.dataset.act != null && ctx) return runAction(ctx, ctx.acts[+t.dataset.act], root);
  if (t.hasAttribute('data-inv') && ctx) save(xlsxBlob({ 'Commercial invoice': Engine.invoiceRows(ctx.b, ctx.res) }), `draft-invoice-${ctx.b.id || 'booking'}.xlsx`);
  if (t.hasAttribute('data-confirm') && ctx) { root.querySelector('[data-conf]').innerHTML = `<div class="conf"><b>Booking ${esc(ctx.b.id || '')} confirmed.</b> ${esc(confirmationText(ctx.b, ctx.res))}<p class="sm mut" style="margin-top:6px">This is a demo: no carrier or customer is contacted from this page.</p></div>`; t.disabled = true; t.textContent = 'Confirmed'; }
  if (t.hasAttribute('data-copy') && ctx) { const txt = summaryText(ctx.b, ctx.res); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => { t.textContent = 'Copied'; }, () => { t.textContent = 'Copy failed'; }); }
  if (t.dataset.prio) whatIf({ priority: t.dataset.prio });
  if (t.dataset.pal) whatIf({ pallets: Math.max(1, (+draft.pallets || 1) + +t.dataset.pal) });
});
/* one-click fixes: the engine proposes, the page applies, the engine re-checks */
function runAction(ctx, a, root) {
  if (!a) return;
  if (root.closest('#dlgBook')) return fixUpload(ctx.b.id, a);
  if (busy || !lastRes) return;
  const before = clone(draft); Object.assign(draft, Engine.applyFix(draft, a)); pendingFix = a.label; say('me', 'Fix it: ' + a.label); afterDraft(before);
}

/* ---------- chat ---------- */
let draft, hist, lastAsked, lastRes, lastSummary = '', busy = false, prevFields = {}, pendingFix = '';
const log = () => $('#log');
function say(who, t) { const el = document.createElement('div'); el.className = 'msg ' + who; el.textContent = t; log().appendChild(el); log().scrollTop = 1e9; hist.push({ role: who, text: t }); }
function quickFor(k) {
  const P = Parser.CITIES;
  if (k === 'originCity') return P.origin;
  if (k === 'destCity') return Object.values(P.dest).flat();
  if (k === 'destType') return ['Warehouse', 'Business address'];
  if (k === 'appointment') return ['Yes, booked', 'No, not booked'];
  if (k === 'priority') return ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'];
  if (k === 'readyDate') return [3, 7, 10].map((n) => TestData.inDays(n));
  if (k && k.startsWith('hs:')) return ["I don't know"];
  if (k && k.startsWith('origin:')) return ['United Kingdom', 'China', 'India', 'Vietnam', 'Turkey', 'Germany'];
  return [];
}
const LIMIT = { originCity: 'We collect from London, Manchester, Birmingham and Leeds only.', destCity: 'We deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam and Rotterdam only.', destType: 'A warehouse or a business address.', appointment: 'Yes or no. Warehouses need a booked delivery slot.', priority: 'One of Cheapest, Fastest, Most reliable, Balanced.', readyDate: 'Today or later, as DD-MM-YYYY.', 'hs:': 'A code of 6 to 10 digits. Not sure? Leave it blank; the check will flag it.', 'origin:': 'One of United Kingdom, China, India, Vietnam, Turkey, Germany.' };
const limitFor = (k) => LIMIT[k] || (k && Object.keys(LIMIT).find((p) => p.endsWith(':') && k.startsWith(p)) && LIMIT[Object.keys(LIMIT).find((p) => p.endsWith(':') && k.startsWith(p))]) || '';
function setQuick(list, label, limit) {
  $('#quick').innerHTML = list.length ? `<div class="lab">${esc(label)}</div><div class="chips">${list.map((x) => `<button class="chip" type="button" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>${limit ? `<p class="sub" style="margin:8px 0 0">Limit: ${esc(limit)}</p>` : ''}` : '';
}
$('#quick').addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) send(c.dataset.q); });
function startChat() {
  draft = Parser.newDraft(); hist = []; lastAsked = null; lastRes = null; lastSummary = ''; prevFields = {}; log().innerHTML = '';
  say('bot', 'Tell me about the shipment in your own words. I will fill in the booking sheet as we go and only ask for what is missing. You can change anything later, for example “add a pallet” or “make it fastest”.');
  setQuick([], ''); renderSheet(); renderChatEmpty();
}
function renderChatEmpty() {
  $('#chatReport').innerHTML = `<div class="empty-s" style="padding:6px 0"><h3>The report appears here</h3><p class="mut">Once the booking is complete you will see a verdict, all ten rule results, the exact fix for each problem, and the carrier comparison. Try an example on the left to see it in a few seconds.</p></div>`;
}
function renderSheet() {
  const d = draft, wh = /warehouse/i.test(d.destType || ''), der = d._derived || {};
  const F = [['From', d.originCity], ['To', d.destCity], ['Delivery to', d.destType]];
  if (wh) F.push(['Appointment', d.appointment]);
  F.push(['Ready to ship', d.readyDate], ['Priority', d.priority], ['Pallets', d.pallets], ['Cartons', d.cartons, der.cartons], ['Gross weight', d.grossWeight != null ? d.grossWeight + ' kg' : null], ['Declared value', d.declaredValue != null ? gbp(d.declaredValue) : null, der.declaredValue]);
  const done = F.filter((f) => f[1] != null && f[1] !== '').length;
  $('#progT').textContent = `${done} of ${F.length} details`; $('#progB').style.width = Math.round((done / F.length) * 100) + '%';
  $('#fields').innerHTML = F.map(([k, v, calc]) => {
    const has = v != null && v !== '', fresh = has && prevFields[k] !== v;
    return `<div class="f ${has ? '' : 'empty'} ${fresh ? 'new' : ''}"><dt>${k}</dt><dd>${has ? esc(v) + (calc ? ' <span class="calc">calculated</span>' : '') : 'Not given yet'}</dd></div>`; }).join('');
  prevFields = Object.fromEntries(F.map(([k, v]) => [k, v]));
  $('#items').innerHTML = d.items.length ? `<table><thead><tr><th>Item</th><th>HS code</th><th>Qty</th><th>Unit price</th><th>Per carton</th><th>Cartons</th><th>Unit kg</th><th>Origin</th></tr></thead><tbody>${d.items.map((it) => {
    const c = (v, f) => (v == null || v === '' ? '<span class="mut">needed</span>' : esc(f ? f(v) : v));
    return `<tr><td class="wrap">${esc(it.desc || it.sku)}</td><td>${(d.skip || {})['hs:' + (it.desc || it.sku)] ? '<span class="mut">unknown</span>' : c(it.hs)}</td><td>${c(it.qty)}</td><td>${c(it.unitPrice, gbp)}</td><td>${c(it.upc)}</td><td>${c(it.cartons)}</td><td>${c(it.unitWeight)}</td><td>${(d.skip || {})['origin:' + (it.desc || it.sku)] ? '<span class="mut">unknown</span>' : c(it.origin)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="mut">Items appear here as you describe them: what it is, how many, the unit price and units per carton.</p>';
}
const fieldsLabel = { originCity: 'from', destCity: 'to', destType: 'delivery to', readyDate: 'ready date', priority: 'priority', pallets: 'pallets', grossWeight: 'gross weight', appointment: 'appointment' };
function diff(a, b) { const out = []; for (const k in fieldsLabel) if (a[k] != null && b[k] != null && a[k] !== b[k]) out.push(`${fieldsLabel[k]}: ${a[k]} → ${b[k]}`); return out; }
function describeDelta(prev, res) {
  const out = [], p = prev.recommendation, r = res.recommendation;
  if (prev.label !== res.label) out.push(`${prev.label} → ${res.label}`);
  if (p && r && (p.carrier !== r.carrier || p.service !== r.service)) out.push(`carrier ${p.carrier} → ${r.carrier}`);
  else if (p && r) out.push(`carrier unchanged (${r.carrier})`);
  if (p && r && p.total !== r.total) out.push(`cost ${gbp(p.total)} → ${gbp(r.total)}`);
  return out;
}
async function extract(text) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9500);
    const r = await fetch('/api/chat', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, draft, history: hist.slice(-8) }) });
    clearTimeout(t); const j = await r.json();
    if (j && j.draft) { const d = j.draft; d.items = Array.isArray(d.items) ? d.items : []; d.skip = { ...(draft.skip || {}), ...(d.skip || {}) }; return Parser.derive(d); }
  } catch (e) { /* use the rule-based parser */ }
  const n = new Date(); return Parser.fallbackExtract(draft, text, new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())), lastAsked);
}
function afterDraft(before) {
  const m = Parser.missing(draft); renderSheet();
  if (m.length) {
    lastAsked = m[0].key; const sm = (draft.originCity || draft.destCity ? `${draft.originCity || '?'} to ${draft.destCity || '?'}` : '');
    const intro = sm && sm !== lastSummary ? `Got it: ${sm}.` : 'Thanks.'; lastSummary = sm;
    say('bot', `${intro}\n\nStill needed: ${m.slice(0, 3).map((x) => x.ask).join('; ')}${m.length > 3 ? '; then a few smaller details' : ''}.`);
    setQuick(quickFor(lastAsked), 'Quick answers', limitFor(lastAsked)); renderChatEmpty(); return;
  }
  lastAsked = null; const b = { id: 'BK-CHAT', ...draft, items: draft.items }, prev = lastRes, res = checkBooking(b, CARRIERS); lastRes = res;
  const changes = prev ? diff(before, draft) : [], delta = prev ? describeDelta(prev, res) : [];
  const calc = Object.keys(draft._derived || {}).length ? ` I worked out ${Object.keys(draft._derived).map((k) => (k === 'declaredValue' ? 'the declared value' : 'the carton count')).join(' and ')} from your item lines.` : '';
  say('bot', `${changes.length ? 'Updated: ' + changes.join('; ') + '. ' : pendingFix ? 'Applied: ' + pendingFix + '. ' : 'Booking complete. '}${res.headline}${calc}\nThe full report is in the report panel.`);
  pendingFix = ''; setQuick(['Add a pallet', 'Make it fastest', 'Make it cheapest', 'Send it to Hamburg instead'], 'Try a change');
  $('#chatReport').innerHTML = report(b, res, { live: true, still: !!prev, change: changes.length || delta.length ? [...changes, ...delta].join(' · ') : '' });
}
async function send(text) {
  text = (text == null ? $('#inp').value : text).trim(); if (!text || busy) return; $('#inp').value = ''; busy = true; await carriersReady;
  say('me', text); const before = clone(draft); draft = await extract(text); afterDraft(before); busy = false;
}
function whatIf(patch) { if (busy || !lastRes) return; const before = clone(draft); const what = Object.entries(patch).map(([k, v]) => `${fieldsLabel[k]} ${before[k]} → ${v}`).join(', '); Object.assign(draft, patch); say('me', 'Change ' + what); afterDraft(before); }
$('#cmp').onsubmit = (e) => { e.preventDefault(); send(); };
$('#reset').onclick = startChat;

/* scripted examples (what a seller might type, then quick answers) */
const EX = [
  { t: 'Clean booking', s: '1,080 mugs, Manchester to Frankfurt. Expect: Ready to book, Carrier A.', m: () => ['I need to send 1080 ceramic mugs at £5 each from Manchester to Frankfurt. 12 per carton, 0.5 kg each, 3 pallets, 620 kg gross. Warehouse with a delivery appointment booked. Cheapest.', TestData.inDays(10), '691200', 'United Kingdom'] },
  { t: 'Pallets too heavy', s: '2,400 kg on 3 pallets to Hamburg. Expect: Blocked, R-05 with a pallet plan.', m: () => ['300 steel brackets at £20 each, 10 per carton, 7.5 kg per unit. 2,400 kg gross on 3 pallets from Manchester to a Hamburg warehouse. Balanced.', 'Yes, booked', TestData.inDays(7), '731700', 'United Kingdom'] },
  { t: 'Dangerous goods', s: 'Lithium power banks to Paris. Expect: Blocked, R-06.', m: () => ['24 lithium power banks at £15 each, 24 per carton, 0.3 kg each, 1 pallet of 12 kg from London to a Paris business address, ready ' + TestData.inDays(5) + ', fastest.', '850760', 'China'] },
];
$('#ex').innerHTML = EX.map((x, i) => `<button type="button" data-ex="${i}"><b>${x.t}</b><span>${x.s}</span></button>`).join('');
async function runScript(i) { startChat(); for (const t of EX[i].m()) { await send(t); await new Promise((r) => setTimeout(r, 350)); } }
$('#ex').addEventListener('click', (e) => { const b = e.target.closest('[data-ex]'); if (b && !busy) runScript(+b.dataset.ex); });

/* ---------- upload ---------- */
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const findHeader = (rows) => rows.findIndex((r) => r.some((c) => /^booking id\b/.test(norm(c))));
const readSheet = (wb, re) => { const n = Object.keys(wb).find((x) => re.test(x.toLowerCase())); return n ? wb[n].map((r) => r || []) : null; };
const colMap = (head, spec) => { const m = {}; for (const [k, re] of Object.entries(spec)) m[k] = head.findIndex((h) => re.test(norm(h))); return m; };
const split2 = (v, sep) => { const s = String(v == null ? '' : v); const i = s.indexOf(sep); return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; };
function pickSheets(wb) { // find the two sheets by their column headings first, by name second, so any sheet names work
  let B = null, I = null;
  for (const rows of Object.values(wb)) {
    const r = (rows || []).map((x) => x || []), h = findHeader(r); if (h < 0) continue;
    const head = r[h].map(norm).join('|');
    if (/\bsku\b|hs code|units per carton/.test(head)) I = I || r; else if (/origin city|destination city|pallets/.test(head)) B = B || r;
  }
  return [B || readSheet(wb, /booking/), I || readSheet(wb, /item/)];
}
function parseWorkbook(wb) {
  const [B, I] = pickSheets(wb);
  if (!B || !I) throw new Error(`Could not tell which sheet holds the bookings and which holds the items. Sheets found: ${Object.keys(wb).join(', ') || 'none'}. Each needs a header row starting with "Booking ID".`);
  const bh = findHeader(B), ih = findHeader(I); if (bh < 0 || ih < 0) throw new Error('Could not find the header row (a column called "Booking ID").');
  const bs = { id: /^booking id/, seller: /seller name|^seller$/, oc: /origin city/, ocountry: /origin country/, dc: /destination city/, dcountry: /destination country/, destType: /destination type/, readyDate: /ready/, priority: /priority/, pallets: /^pallets/, cartons: /^cartons/, declaredValue: /declared value/, currency: /^currency/, grossWeight: /gross weight/, appointment: /appointment/ };
  const is = { id: /^booking id/, sku: /^sku/, desc: /description/, hs: /^hs/, qty: /^quantity/, unitPrice: /^unit price/, upc: /units per carton/, cartons: /^cartons/, unitWeight: /^unit weight/, origin: /country of origin/ };
  const bm = colMap(B[bh], bs), im = colMap(I[ih], is);
  const isExample = (r) => r.some((c) => /^\(?\s*example\s*\)?$/i.test(String(c).trim()));
  const get = (r, i) => (i >= 0 && r[i] != null ? r[i] : '');
  const bookings = new Map(), orphans = [];
  for (const r of B.slice(bh + 1)) {
    const id = String(get(r, bm.id)).trim(); if (!id || isExample(r)) continue;
    let oc = get(r, bm.oc), ocountry = bm.ocountry >= 0 && bm.ocountry !== bm.oc ? get(r, bm.ocountry) : 'United Kingdom';
    let dc = get(r, bm.dc), dcountry = bm.dcountry >= 0 && bm.dcountry !== bm.dc ? get(r, bm.dcountry) : '';
    if (bm.oc >= 0 && bm.oc === bm.ocountry) [oc, ocountry] = split2(oc, '·');
    if (bm.dc >= 0 && bm.dc === bm.dcountry) [dc, dcountry] = split2(dc, '·');
    if (!dcountry) dcountry = Parser.destCountryOf(dc) || '';
    bookings.set(id, { id, seller: get(r, bm.seller), originCity: String(oc).trim(), originCountry: String(ocountry || 'United Kingdom').trim(), destCity: String(dc).trim(), destCountry: String(dcountry).trim(),
      destType: String(get(r, bm.destType)).trim(), readyDate: get(r, bm.readyDate), priority: String(get(r, bm.priority)).trim() || 'Balanced', pallets: get(r, bm.pallets), cartons: get(r, bm.cartons),
      declaredValue: get(r, bm.declaredValue), currency: 'GBP', grossWeight: get(r, bm.grossWeight), appointment: String(get(r, bm.appointment)).trim(), items: [] });
  }
  for (const r of I.slice(ih + 1)) {
    const id = String(get(r, im.id)).trim(); if (!id || isExample(r)) continue;
    if (!bookings.has(id)) { orphans.push(id + ' (' + String(get(r, im.sku)).trim() + ')'); continue; }
    let sku = get(r, im.sku), desc = im.desc >= 0 && im.desc !== im.sku ? get(r, im.desc) : '';
    if (im.sku >= 0 && im.sku === im.desc) [sku, desc] = split2(sku, '·');
    const hsRaw = get(r, im.hs);
    bookings.get(id).items.push({ sku: String(sku).trim(), desc: String(desc).trim(), hs: hsRaw === '' ? '' : String(hsRaw).trim(), qty: get(r, im.qty), unitPrice: get(r, im.unitPrice), upc: get(r, im.upc), cartons: get(r, im.cartons), unitWeight: get(r, im.unitWeight), origin: String(get(r, im.origin)).trim() });
  }
  return { list: [...bookings.values()], orphans };
}
const U = { results: [], orphans: [], filter: 'All', fixes: {} };
function checkOne(b) {
  const res = checkBooking(b, CARRIERS);
  if (!(b.items || []).length) { res.findings.unshift({ rule: 'R-04', severity: 'Red', message: `${b.id} has no item lines on the Items sheet, so value, cartons and weight cannot be checked.`, fix: 'Add the item rows for this booking, or remove the booking.', item: null, action: null }); res.status = 'Red'; res.label = 'Blocked'; res.headline = 'Blocked: no item lines for this booking.'; }
  return res;
}
const chevron = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6l5 5 5-5"/></svg>';
const STAT = [['All', 'Bookings'], ['Red', "Can't ship yet"], ['Amber', 'Ship with care'], ['Green', 'Good to go']];
function renderUpload() {
  const R = U.results, c = { All: R.length, Red: 0, Amber: 0, Green: 0 }; R.forEach((x) => c[x.res.status]++);
  const nfix = Object.values(U.fixes).reduce((a, l) => a + l.length, 0);
  $('#sumbar').innerHTML = `<button class="btn sm" type="button" id="csvBtn">Download results (CSV)</button>${nfix ? `<button class="btn sm pri" type="button" id="fixBtn">Download corrected file (${nfix} fixed)</button>` : ''}<button class="btn sm" type="button" id="againBtn">Check another file</button>`;
  const rows = R.filter((x) => U.filter === 'All' || x.res.status === U.filter);
  $('#legend').innerHTML = R.length ? `<span><i class="Green"></i>${c.Green} good to go</span><span><i class="Amber"></i>${c.Amber} ship with care</span><span><i class="Red"></i>${c.Red} can't ship yet</span>` : '';
  $('#strip').innerHTML = R.map(({ b, res }) => `<button type="button" class="${res.status}" data-b="${esc(b.id)}" title="${esc(b.id)}: ${esc(Engine.PLAIN[res.status])}" aria-label="${esc(b.id)}, ${esc(Engine.PLAIN[res.status])}"></button>`).join('');
  $('#uploadResult').innerHTML = (U.orphans.length ? `<div class="pb" style="padding-bottom:0"><div class="change"><b>Things we noticed in the file.</b> ${U.orphans.length} item row${U.orphans.length === 1 ? '' : 's'} belong to a Booking ID that is not on the Bookings sheet and were not checked: ${esc(U.orphans.join(', '))}.</div></div>` : '') +
    `<div class="stats">${STAT.map(([k, n]) => `<button class="stat ${k}" type="button" data-f="${k}" aria-pressed="${U.filter === k}"><span>${n}</span><b>${c[k]}</b><span>${k === 'All' ? 'showing all' : 'tap to show'}</span></button>`).join('')}</div>` +
    (rows.length ? rows.map(({ b, res }) => {
      const rec = res.recommendation, n = res.findings.length, fx = (U.fixes[b.id] || []).length;
      return `<div class="brow"><button class="bh" type="button" data-b="${esc(b.id)}"><span class="bid">${esc(b.id)}</span><span class="br"><b>${esc(b.seller || '')}</b><span>${esc(b.originCity)} to ${esc(b.destCity)}${b.destCountry ? ', ' + esc(b.destCountry) : ''}</span></span><span class="badge ${res.status}">${esc(Engine.PLAIN[res.status])}${n ? ' · ' + n : ''}</span><span class="bc">${rec ? esc(rec.carrier) + ' · ' + gbp(rec.total) : 'No carrier yet'}<small class="mut" style="display:block;font-weight:400">${rec ? 'arrives ' + esc(rec.eta) : ''}${fx ? (rec ? ' · ' : '') + fx + ' fixed' : ''}</small></span>${chevron}</button></div>`; }).join('') : '<div class="empty-s"><p class="mut">No bookings in this group.</p></div>');
}
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-f]'); if (f) { U.filter = f.dataset.f; renderUpload(); }
  const h = e.target.closest('[data-b]'); if (h) openBook(h.dataset.b);
  if (e.target.id === 'csvBtn') downloadCsv();
  if (e.target.id === 'fixBtn') downloadFixed();
  if (e.target.id === 'againBtn') $('#file').click();
});
function openBook(id, change) {
  const x = U.results.find((r) => r.b.id === id); if (!x) return;
  const body = $('#bookBody'), top = body.scrollTop, d = $('#dlgBook');
  $('#bookTitle').textContent = `${id} · ${x.b.seller || ''}`;
  body.innerHTML = report(x.b, x.res, { change, still: d.open });
  if (!d.open) d.showModal(); else body.scrollTop = top;
}
/* one-click fix on an uploaded booking: apply, re-run every rule, say what changed */
function fixUpload(id, a) {
  const i = U.results.findIndex((x) => x.b.id === id); if (i < 0) return;
  const was = U.results[i].res, nb = Engine.applyFix(U.results[i].b, a), res = checkOne(nb);
  U.results[i] = { b: nb, res }; (U.fixes[id] = U.fixes[id] || []).push(a.label);
  renderUpload(); openBook(id, `Fixed: ${a.label}. Now ${Engine.PLAIN[res.status]} with ${Engine.passedCount(res)} of 10 checks passed (was ${Engine.PLAIN[was.status]}, ${Engine.passedCount(was)} of 10).`);
}
function showUpload(parsed, label) {
  U.orphans = parsed.orphans; U.filter = 'All'; U.fixes = {};
  U.results = parsed.list.map((b) => ({ b, res: checkOne(b) }));
  $('#fileInfo').textContent = `${label}: ${parsed.list.length} booking${parsed.list.length === 1 ? '' : 's'}, ${parsed.list.reduce((a, b) => a + b.items.length, 0)} item lines checked.`;
  renderUpload(); if (U.results.length === 1) openBook(U.results[0].b.id);
}
function downloadCsv() {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Booking ID', 'Seller', 'Status', 'Checks passed', 'Rule', 'Severity', 'What is wrong', 'How to fix', 'Recommended carrier', 'Cost (GBP)', 'ETA']];
  for (const { b, res } of U.results) {
    const rec = res.recommendation, rc = rec ? [rec.carrier + ' ' + rec.service, rec.total, rec.eta] : ['', '', ''], st = `${Engine.PLAIN[res.status]} (${res.label})`, ps = Engine.passedCount(res) + '/10';
    if (!res.findings.length) rows.push([b.id, b.seller, st, ps, '', '', 'No issues', '', ...rc]);
    res.findings.forEach((f) => rows.push([b.id, b.seller, st, ps, f.rule, f.severity, f.message, f.fix, ...rc]));
  }
  save(new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }), 'preflight-report.csv');
}
function downloadFixed() {
  const ddmm = (v) => { const d = Engine.parseDate(v); return d ? `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` : v; };
  save(xlsxBlob(TestData.fromBookings(U.results.map(({ b }) => ({ ...b, readyDate: ddmm(b.readyDate) })))), 'preflight-corrected.xlsx');
}
async function save(blob, name) {
  // Inside a claude.ai artifact the viewer's own save prompt is the only way a file reaches the disk; elsewhere a normal download.
  try { const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) { await dl.save({ filename: name, data: blob }); return; } } catch (e) { if (e && e.code) return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const xlsxBlob = (sheets) => new Blob([writeXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
async function handleBuffer(buf, label) {
  await carriersReady;
  try { showUpload(parseWorkbook(await readXlsx(buf)), label); }
  catch (e) { $('#fileInfo').textContent = ''; $('#sumbar').innerHTML = ''; $('#strip').innerHTML = ''; $('#uploadResult').innerHTML = `<div class="pb"><div class="errbox"><b>Could not read that file.</b><br>${esc(e.message)}<br>Check that it is an .xlsx whose two sheets each have a header row starting with “Booking ID”, or download the template.</div></div>`; }
}
const handleFile = async (f) => { setMode(2); await handleBuffer(await f.arrayBuffer(), f.name); };
$('#file').onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; };
const drop = $('#drop');
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } };
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
$('#dlTpl').onclick = () => save(xlsxBlob(TestData.template()), 'preflight-template.xlsx');
async function runTestFile() { setMode(2); const u = writeXlsx(TestData.sheets(false)); await handleBuffer(u.buffer, 'Test file'); }
$('#runTest').onclick = runTestFile;
function emptyUpload() {
  $('#sumbar').innerHTML = ''; $('#strip').innerHTML = ''; $('#legend').innerHTML = '';
  $('#uploadResult').innerHTML = `<div class="empty-s"><h3>Results appear here</h3><p class="mut">Each booking gets a status, all ten rule results, the exact fixes and a carrier recommendation. Filter by status and download the whole report as a CSV.</p>
  <ul><li><b>Bookings sheet:</b> one row per booking with the route, ready date, priority, pallets, cartons, declared value, gross weight and appointment.</li><li><b>Items sheet:</b> one row per product line with the Booking ID, SKU, description, HS code, quantity, unit price, units per carton, cartons, unit weight and country of origin.</li><li>Dates are DD-MM-YYYY. HS code and country of origin may be blank; the checks will say what that costs you.</li></ul></div>`;
}

/* ---------- dialogs ---------- */
function openRules(focusId) {
  $('#rulesBody').innerHTML = `<div class="h3">The ten rules</div><div class="tw"><table><thead><tr><th>Rule</th><th>Check</th><th>If it fails</th><th class="wrap">What it means</th></tr></thead><tbody>${RULES.map(([id, n, s, d]) => `<tr id="rb-${id}"><td><b>${id}</b></td><td class="wrap">${esc(n)}</td><td><span class="badge ${s}">${s}</span></td><td class="wrap">${esc(d)}</td></tr>`).join('')}</tbody></table></div>
  <p class="mut sm" style="margin-top:10px">Any red makes the booking <b>Blocked</b> (shown as “Can't ship yet”). Only amber makes it <b>At risk</b> (“Ship with care”). Nothing flagged is <b>Ready to book</b> (“Good to go”).</p>
  <div class="h3">Carrier rate card (GBP per pallet)</div><div class="tw"><table><thead><tr><th>Carrier</th><th>Service</th><th>Germany</th><th>France</th><th>Netherlands</th><th>Transit</th><th>On time</th><th>Limit per pallet</th></tr></thead><tbody>${['Carrier A', 'Carrier B', 'Carrier C'].map((n) => { const g = (c) => CARRIERS.find((x) => x.carrier === n && x.destination === c) || {}; const a = g('Germany'); return `<tr><td>${n}</td><td>${esc(a.service || '')}</td><td>${gbp(g('Germany').pricePerPallet || 0)}</td><td>${gbp(g('France').pricePerPallet || 0)}</td><td>${gbp(g('Netherlands').pricePerPallet || 0)}</td><td>${a.transitDays} days</td><td>${a.onTime}%</td><td>${a.maxWeightPerPallet} kg</td></tr>`; }).join('')}</tbody></table></div>
  <div class="h3">How the carrier is chosen</div>
  <p>Carriers whose weight limit per pallet is below your load are dropped first. The rest are ranked by what you said matters: <b>Cheapest</b> (cost, then on-time, then transit), <b>Fastest</b> (transit, then cost, then on-time), <b>Most reliable</b> (on-time, then cost, then transit). <b>Balanced</b> picks the carrier whose worst result across cost, speed and reliability is the least bad. Estimated arrival counts working days (Monday to Friday) and skips UK and destination-country public holidays.</p>`;
  const d = $('#dlgRules'); if (!d.open) d.showModal();
  if (focusId) { const row = $('#rb-' + focusId); if (row) { row.scrollIntoView({ block: 'center' }); row.style.background = 'var(--acc-soft)'; } }
}
$('#openRules').onclick = () => openRules();
function openTest() {
  $('#testBody').innerHTML = `<p>Use these to check the tool the way a reviewer would. Every planted mistake has a known right answer.</p>
  <div class="h3">Spreadsheet</div>
  <div class="acts" style="margin-top:0"><button class="btn pri" type="button" id="tRun">Run the test file here</button><button class="btn" type="button" id="tFile">Download test file (.xlsx)</button><button class="btn" type="button" id="tTpl">Download blank template</button></div>
  <p class="mut sm">The test file has 19 bookings, one planted mistake per rule plus edge cases, an item with no booking, and an Expected sheet with the right answer for each. Ready dates are set relative to today.</p>
  <div class="h3">Chat scripts</div><div class="scr">${EX.map((x, i) => `<div><span><b>${x.t}</b><br><span class="mut sm">${x.s}</span></span><button class="btn sm" type="button" data-run="${i}">Run in chat</button></div>`).join('')}</div>
  <div class="h3">Expected results for the test file</div><div class="tw"><table><thead><tr><th>Booking</th><th class="wrap">Expected result</th></tr></thead><tbody>${TestData.CASES.map(([id, , , exp]) => `<tr><td><b>${id}</b></td><td class="wrap">${esc(exp)}</td></tr>`).join('')}<tr><td><b>BK-999</b></td><td class="wrap">Item with no booking: reported as a data issue</td></tr></tbody></table></div>`;
  const d = $('#dlgTest'); if (!d.open) d.showModal();
}
$('#openTest').onclick = openTest;
$('#testBody').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'tRun') { $('#dlgTest').close(); runTestFile(); }
  if (t.id === 'tFile') save(xlsxBlob(TestData.sheets(true)), 'preflight-test-file.xlsx');
  if (t.id === 'tTpl') save(xlsxBlob(TestData.template()), 'preflight-template.xlsx');
  if (t.dataset.run) { $('#dlgTest').close(); setMode(1); runScript(+t.dataset.run); }
});
document.querySelectorAll('dialog').forEach((d) => { d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); }); });

/* ---------- command menu (Ctrl or Cmd + K) ---------- */
const CMDS = [
  ['Describe a shipment', 'chat', () => setMode(1)],
  ['Upload a bookings file', '.xlsx', () => { setMode(2); $('#file').click(); }],
  ['Run the 19-booking test file', 'every rule once', () => runTestFile()],
  ['Start a new booking', 'clears the current one', () => { setMode(1); startChat(); }],
  ['Download blank template', '.xlsx', () => save(xlsxBlob(TestData.template()), 'preflight-template.xlsx')],
  ['Download the test file', 'with expected results', () => save(xlsxBlob(TestData.sheets(true)), 'preflight-test-file.xlsx')],
  ['Open the rulebook and rate card', 'ten rules', () => openRules()],
  ['Open test data and chat scripts', '', () => openTest()],
];
function renderCmd() {
  const q = $('#cmdIn').value.trim().toLowerCase();
  $('#cmdList').innerHTML = CMDS.map((c, i) => [c, i]).filter(([c]) => !q || (c[0] + ' ' + c[1]).toLowerCase().includes(q)).map(([c, i]) => `<button type="button" data-cmd="${i}">${esc(c[0])}<span>${esc(c[1])}</span></button>`).join('') || '<p class="mut sm" style="padding:10px 12px">No match.</p>';
}
function openCmd() { const d = $('#dlgCmd'); $('#cmdIn').value = ''; renderCmd(); if (!d.open) d.showModal(); $('#cmdIn').focus(); }
$('#kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
$('#openCmd').onclick = openCmd;
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); } });
$('#cmdIn').oninput = renderCmd;
$('#dlgCmd').addEventListener('keydown', (e) => {
  const bs = [...document.querySelectorAll('#cmdList button')], i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (bs[i + 1] || bs[0] || $('#cmdIn')).focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? bs[i - 1] : $('#cmdIn')).focus(); }
  if (e.key === 'Enter' && document.activeElement === $('#cmdIn') && bs[0]) { e.preventDefault(); bs[0].click(); }
});
$('#cmdList').addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (!b) return; $('#dlgCmd').close(); CMDS[+b.dataset.cmd][2](); });

/* ---------- start ---------- */
startChat(); emptyUpload(); if (location.hash === '#upload') setMode(2);
