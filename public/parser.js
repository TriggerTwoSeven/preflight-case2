/* Conversation helpers: deterministic "what is still missing?" + rule-based fallback extractor.
   The LLM (api/chat.js) only fills the draft; the questions asked always come from missing(). */
(function (root) {
  const CITIES = {
    origin: ['London', 'Manchester', 'Birmingham', 'Leeds'],
    dest: { Germany: ['Berlin', 'Frankfurt', 'Hamburg'], France: ['Paris', 'Lyon'], Netherlands: ['Amsterdam', 'Rotterdam'] },
  };
  const destCountryOf = (city) => Object.keys(CITIES.dest).find((c) => CITIES.dest[c].some((x) => x.toLowerCase() === String(city || '').toLowerCase()));
  const canon = (city, list) => list.find((x) => x.toLowerCase() === String(city || '').toLowerCase());

  const newDraft = () => ({ originCity: null, originCountry: 'United Kingdom', destCity: null, destCountry: null, destType: null, readyDate: null,
    priority: null, pallets: null, cartons: null, declaredValue: null, currency: 'GBP', grossWeight: null, appointment: null, items: [], skip: {} });

  /* Fill derived fields from item lines. Never overwrites something the seller stated explicitly. */
  function derive(d) {
    d.originCountry = 'United Kingdom'; d.currency = 'GBP';
    if (d.destCity) { const c = destCountryOf(d.destCity); if (c) { d.destCountry = c; d.destCity = canon(d.destCity, CITIES.dest[c]); } }
    if (d.originCity) d.originCity = canon(d.originCity, CITIES.origin) || d.originCity;
    let cartons = 0, value = 0, allCartons = d.items.length > 0, allValue = d.items.length > 0;
    d.items.forEach((it, i) => {
      if (!it.sku) it.sku = it.desc || `ITEM-${i + 1}`;
      const q = +it.qty, u = +it.upc;
      if ((it.cartons == null || it.cartons === '') && q > 0 && u > 0) it.cartons = Math.ceil(q / u);
      if (it.cartons != null && it.cartons !== '') cartons += +it.cartons; else allCartons = false;
      if (it.qty != null && it.unitPrice != null && it.qty !== '' && it.unitPrice !== '') value += +it.qty * +it.unitPrice; else allValue = false;
    });
    d._derived = {};
    if (d.cartons == null && allCartons) { d.cartons = cartons; d._derived.cartons = true; }
    if (d.declaredValue == null && allValue) { d.declaredValue = Math.round(value * 100) / 100; d._derived.declaredValue = true; }
    return d;
  }

  /* Ordered list of what we still need to ask. Each: {key, ask} */
  function missing(d) {
    derive(d);
    const m = [];
    const need = (key, ask) => m.push({ key, ask });
    if (!d.originCity) need('originCity', 'which UK city the goods are collected from (London, Manchester, Birmingham or Leeds)');
    if (!d.destCity) need('destCity', 'the destination city (Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam)');
    if (!d.destType) need('destType', 'whether it goes to a warehouse or a business address');
    if (/warehouse/i.test(d.destType || '') && !d.appointment) need('appointment', 'whether a delivery appointment is booked at the warehouse');
    if (!d.readyDate) need('readyDate', 'the ready-to-ship date (DD-MM-YYYY)');
    if (!d.priority) need('priority', 'what matters most: cheapest, fastest, most reliable, or balanced');
    if (!d.items.length) need('items', 'what is in the shipment: for each product the description, quantity, unit price and units per carton');
    d.items.forEach((it) => {
      const lab = it.desc || it.sku || 'item';
      const gaps = [];
      if (!it.qty) gaps.push('quantity');
      if (it.unitPrice == null || it.unitPrice === '') gaps.push('unit price (GBP)');
      if (!it.upc && !it.cartons) gaps.push('units per carton');
      if (it.unitWeight == null || it.unitWeight === '') gaps.push('unit weight (kg)');
      if (gaps.length) need('item:' + lab, `for “${lab}”: ${gaps.join(', ')}`);
    });
    if (d.pallets == null) need('pallets', 'how many pallets');
    if (d.grossWeight == null) need('grossWeight', 'the total gross weight in kg, including cartons and pallets');
    d.items.forEach((it) => {
      const lab = it.desc || it.sku || 'item';
      if (!d.skip['hs:' + lab] && !String(it.hs || '').trim()) need('hs:' + lab, `the HS code for “${lab}” (say “don't know” to skip – I'll flag it)`);
      if (!d.skip['origin:' + lab] && !String(it.origin || '').trim()) need('origin:' + lab, `where “${lab}” was made (country of origin)`);
    });
    return m;
  }

  /* ---------- rule-based fallback extractor ---------- */
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const COUNTRIES = ['United Kingdom', 'China', 'India', 'Vietnam', 'Turkey', 'Germany'];

  function parseWhen(t, today) {
    let m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
    if (m) return `${pad(m[1])}-${pad(m[2])}-${m[3]}`;
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
    if (m) { const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1; let y = m[3] ? +m[3] : today.getUTCFullYear(); return `${pad(m[1])}-${pad(mon)}-${y}`; }
    if (/\btomorrow\b/i.test(t)) { const d = new Date(today.getTime() + 86400000); return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`; }
    if (/\btoday\b/i.test(t)) return `${pad(today.getUTCDate())}-${pad(today.getUTCMonth() + 1)}-${today.getUTCFullYear()}`;
    const dow = t.match(/\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday)\b/i);
    if (dow) { const idx = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dow[1].toLowerCase()); let d = new Date(today.getTime() + 86400000); while (d.getUTCDay() !== idx) d = new Date(d.getTime() + 86400000); return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`; }
    return null;
  }

  function fallbackExtract(draft, text, today, lastAsked) {
    const d = JSON.parse(JSON.stringify(draft)); const t = String(text);
    // cities: "from X to Y", else any known city
    const has = (c) => new RegExp('\\b' + (c === 'Frankfurt' ? 'Frankfurt|Frankfort' : c) + '\\b', 'i').test(t);
    const fromTo = t.match(/from\s+([A-Za-z]+)\s+(?:to|->|→)\s+([A-Za-z]+)/i);
    CITIES.origin.forEach((c) => { if (has(c)) d.originCity = c; });
    Object.values(CITIES.dest).flat().forEach((c) => { if (has(c)) d.destCity = c; });
    if (fromTo) { const o = canon(fromTo[1], CITIES.origin), de = Object.values(CITIES.dest).flat().find((x) => x.toLowerCase() === fromTo[2].toLowerCase()); if (o) d.originCity = o; if (de) d.destCity = de; }
    if (/\bwarehouse\b|\bfulfil?lment\b|\bFBA\b/i.test(t)) d.destType = 'Warehouse';
    else if (/business address|\boffice\b|\bshop\b|\bstore\b|\bcustomer\b/i.test(t)) d.destType = 'Business address';
    if (/\b(no|not)\b[^.]{0,20}appointment|appointment[^.]{0,20}\b(no|not|isn't|hasn't)\b|\bno slot\b/i.test(t)) d.appointment = 'No';
    else if (/appointment|\bslot\b/i.test(t)) d.appointment = /\b(booked|yes|confirmed|got|have|has)\b/i.test(t) ? 'Yes' : d.appointment;
    if (/\bcheap/i.test(t)) d.priority = 'Cheapest'; else if (/\bfast|urgent|asap|quickest|express/i.test(t)) d.priority = 'Fastest';
    else if (/reliab|on[- ]time|dependab/i.test(t)) d.priority = 'Most reliable'; else if (/balanc|no preference|don't mind|either/i.test(t)) d.priority = 'Balanced';
    const w = parseWhen(t, today); if (w) d.readyDate = w;

    // modifications ("add a pallet", "add 2 pallets", "remove a pallet")
    const addP = t.match(/\badd(?:ing)?\s+(?:(\d+)|an?|one)\s+(?:extra\s+|more\s+)?pallets?\b/i);
    const remP = t.match(/\b(?:remove|drop)\s+(?:(\d+)|an?|one)\s+pallets?\b/i);
    if (addP) d.pallets = (+d.pallets || 0) + (addP[1] ? +addP[1] : 1);
    else if (remP) d.pallets = Math.max(0, (+d.pallets || 0) - (remP[1] ? +remP[1] : 1));
    else { const p = t.match(/(\d+)\s+(?:euro\s+)?pallets?\b/i); if (p) d.pallets = +p[1]; else if (/\ba single pallet\b|\bone pallet\b|\b1 pallet\b/i.test(t)) d.pallets = 1; }
    for (const kg of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:kgs?\b|kilos?\b)/gi)) { if (!/\beach\b|\bper\b|\/\s*(unit|piece|item)/i.test(t.slice(kg.index, kg.index + 25))) { d.grossWeight = +kg[1].replace(/,/g, ''); break; } }
    const tonne = t.match(/\b(half a tonne|(\d+(?:\.\d+)?)\s*(?:tonnes?|tons?))\b/i); if (tonne && !d.grossWeight) d.grossWeight = tonne[2] ? +tonne[2] * 1000 : 500;
    const val = t.match(/(?:total|declared|worth|value)[^£\d]{0,25}£\s?([\d,]+(?:\.\d+)?)/i); if (val) d.declaredValue = +val[1].replace(/,/g, '');
    const car = t.match(/(\d+)\s+(?:cartons?|boxes|cases)\b/i); if (car && !/units?\s+(?:per|a|in)\s+(?:each\s+)?(?:carton|box)/i.test(t)) d.cartons = +car[1];

    // item lines: "1080 mugs at £5", "500 units of cotton t-shirts @ £8 each, 20 per carton, 0.3kg each"
    const itemRe = /(\d[\d,]*)\s*(?:x\s+|units?\s+of\s+|pcs?\s+of\s+)?([a-z][a-z0-9 ,'\-]{2,40}?)\s*(?:at|@|for)\s*£\s?(\d+(?:\.\d+)?)(?:\s*(?:each|per unit|a piece|apiece))?/gi;
    let m;
    while ((m = itemRe.exec(t))) {
      const qty = +m[1].replace(/,/g, ''); let desc = m[2].trim().replace(/^(of|the)\s+/i, '');
      if (/pallet|carton|box|kg/i.test(desc)) continue;
      const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const it = d.items.find((x) => x.desc && x.desc.toLowerCase() === desc.toLowerCase()) || (d.items.push({ desc }), d.items[d.items.length - 1]);
      it.qty = qty; it.unitPrice = +m[3];
      const upc = (tail + ' ' + t).match(/(\d+)\s*(?:units?\s+)?(?:per|a|in each|\/)\s*(?:carton|box|case)/i); if (upc) it.upc = +upc[1];
      const uw = tail.match(/(\d*\.?\d+)\s*kg\s*(?:each|per unit|a piece)?/i); if (uw) it.unitWeight = +uw[1];
    }
    // answers to the previous question when the message is short
    const bare = t.trim();
    if (lastAsked && lastAsked.startsWith('item:') ) {
      const lab = lastAsked.slice(5); const it = d.items.find((x) => (x.desc || x.sku) === lab);
      if (it) { const nums = bare.match(/\d+(?:\.\d+)?/g) || []; const pr = bare.match(/£\s?(\d+(?:\.\d+)?)/); if (pr) it.unitPrice = +pr[1];
        const u = bare.match(/(\d+)\s*(?:units?\s+)?(?:per|\/)\s*(?:carton|box)/i); if (u) it.upc = +u[1];
        const wt = bare.match(/(\d*\.?\d+)\s*kg/i); if (wt) it.unitWeight = +wt[1];
        if (!u && !pr && !wt && nums.length === 1) { if (!it.upc && !it.cartons) it.upc = +nums[0]; } }
    }
    if (lastAsked && lastAsked.startsWith('hs:')) { const lab = lastAsked.slice(3); const it = d.items.find((x) => (x.desc || x.sku) === lab);
      const hs = bare.match(/\b\d{4,10}\b/); if (it && hs) it.hs = hs[0]; else if (/don'?t know|skip|not sure|unknown|no idea/i.test(bare)) d.skip['hs:' + lab] = true; }
    if (lastAsked && lastAsked.startsWith('origin:')) { const lab = lastAsked.slice(7); const it = d.items.find((x) => (x.desc || x.sku) === lab);
      const c = COUNTRIES.find((x) => new RegExp('\\b' + (x === 'United Kingdom' ? '(united kingdom|uk|britain|england)' : x) + '\\b', 'i').test(bare)); if (it && c) it.origin = c; else if (/don'?t know|skip|not sure|unknown/i.test(bare)) d.skip['origin:' + lab] = true; }
    if (lastAsked === 'appointment') { if (/^\s*(yes|yep|yeah|booked|confirmed|it is|it's booked)/i.test(bare)) d.appointment = 'Yes'; else if (/^\s*(no|nope|not|none)/i.test(bare)) d.appointment = 'No'; }
    if (lastAsked === 'destType') { if (/ware|fulfil/i.test(bare)) d.destType = 'Warehouse'; else if (/business|office|shop|store|address/i.test(bare)) d.destType = 'Business address'; }
    if (lastAsked === 'pallets' && /^\s*\d+\s*$/.test(bare)) d.pallets = +bare;
    if (lastAsked === 'grossWeight' && /^\s*\d+(\.\d+)?\s*(kg)?\s*$/i.test(bare)) d.grossWeight = parseFloat(bare);
    if (lastAsked === 'readyDate') { const w2 = parseWhen(bare, today); if (w2) d.readyDate = w2; }
    return derive(d);
  }

  const api = { CITIES, newDraft, derive, missing, fallbackExtract, destCountryOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Parser = api;
})(typeof self !== 'undefined' ? self : globalThis);
