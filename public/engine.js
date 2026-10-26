/* Pre-flight engine for Case 2: rulebook R-01..R-10 + carrier recommendation.
   Pure functions, no dependencies. Works in the browser and in Node. */
(function (root) {
  const RED = 'Red', AMBER = 'Amber';

  const num = (v) => {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Number(String(v).replace(/[£,\s]/g, ''));
  };
  const isNum = (v) => Number.isFinite(num(v));
  const gbp = (n) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const r2 = (n) => Math.round(n * 100) / 100;

  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    if (typeof v === 'number' && v > 30000 && v < 80000) { // Excel serial
      return new Date(Math.round((v - 25569) * 86400000));
    }
    if (typeof v !== 'string') return null;
    const s = v.trim();
    let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return null;
  }
  const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  // Public holidays that stop road freight (national holidays only; regional ones are not modelled). Oct 2026 to Dec 2027.
  const HOLIDAYS = {
    'United Kingdom': { '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day (substitute)', '2027-01-01': "New Year's Day", '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-05-03': 'Early May bank holiday', '2027-05-31': 'Spring bank holiday', '2027-08-30': 'Summer bank holiday', '2027-12-27': 'Christmas Day (substitute)', '2027-12-28': 'Boxing Day (substitute)' },
    Germany: { '2026-12-25': 'Christmas Day', '2027-01-01': "New Year's Day", '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-05-06': 'Ascension Day', '2027-05-17': 'Whit Monday' },
    France: { '2026-11-11': 'Armistice Day', '2026-12-25': 'Christmas Day', '2027-01-01': "New Year's Day", '2027-03-29': 'Easter Monday', '2027-05-06': 'Ascension Day', '2027-05-17': 'Whit Monday', '2027-07-14': 'Bastille Day' },
    Netherlands: { '2026-12-25': 'Christmas Day', '2026-12-26': 'Boxing Day', '2027-01-01': "New Year's Day", '2027-03-29': 'Easter Monday', '2027-04-27': "King's Day", '2027-05-06': 'Ascension Day', '2027-05-17': 'Whit Monday' },
  };
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const holidaysFor = (...countries) => Object.assign({}, ...countries.map((c) => HOLIDAYS[c] || {}));
  // Estimated delivery = ready date + transit in WORKING days (Mon-Fri, skipping the given holidays, e.g. holidaysFor('United Kingdom','France')).
  function workDays(d, n, hol) { let x = d; const skipped = []; while (n > 0) { x = addDays(x, 1); const w = x.getUTCDay(); if (w === 0 || w === 6) continue; const k = isoDay(x); if (hol && hol[k]) { skipped.push({ date: fmtDate(x), name: hol[k] }); continue; } n--; } return { date: x, skipped }; }
  const addWorkDays = (d, n, hol) => workDays(d, n, hol).date;

  // R-06 dangerous goods. "hard" = certain hit, "soft" = ask the seller to confirm.
  // Negations are stripped first so "battery-free", "alcohol-free", "non-aerosol" do not trigger.
  const DG_NEG = /\b(battery|batteries|lithium|aerosol|alcohol|flammable|solvent)[\s-]*(free|less)\b|\b(non|no|without)[\s-]+(aerosol|battery|batteries|lithium|flammable|alcohol)\b/gi;
  const DG_HARD = [/lithium/i, /li-?ion/i, /li-?po\b/i, /\bbatter(y|ies)\b/i, /power\s?bank/i, /\brechargeable\b/i, /\bbluetooth\b/i, /\bvape\b|\be-?cig/i,
    /aerosol/i, /\bspray\s?can/i, /hair\s?spray/i, /deodorant/i, /body\s?spray/i, /spray\s?paint/i, /flammable/i,
    /\bpetrol\b|\bgasoline\b|\bdiesel\b/i, /lighter\s?fluid/i, /white\s?spirit/i, /paint\s?thinner|\bthinner\b|\bsolvent/i, /\bacetone\b/i, /\bbutane\b|\bpropane\b/i,
    /perfume|cologne|eau de/i, /nail\s?polish/i, /hand\s?sanit/i];
  const DG_SOFT = [/\bspray\b/i, /\bvarnish\b|\blacquer\b/i, /\balcohol\b/i, /\bpaint\b/i, /\bglue\b|adhesive/i, /fragrance/i];

  /* Returns {level:'hard'|'soft', phrase} or null. phrase = the text that triggered it. */
  function dgScan(desc) {
    const d = String(desc || '').replace(DG_NEG, ' ');
    for (const r of DG_HARD) { const m = d.match(r); if (m) return { level: 'hard', phrase: m[0] }; }
    for (const r of DG_SOFT) { const m = d.match(r); if (m) return { level: 'soft', phrase: m[0] }; }
    return null;
  }

  function itemTotals(b) {
    const items = b.items || [];
    let value = 0, weight = 0, cartons = 0;
    for (const it of items) {
      const q = num(it.qty), p = num(it.unitPrice), w = num(it.unitWeight), c = num(it.cartons);
      if (isNum(q) && isNum(p)) value += q * p;
      if (isNum(q) && isNum(w)) weight += q * w;
      if (isNum(c)) cartons += c;
    }
    return { value, weight, cartons };
  }

  function carriersFor(b, carriers) {
    return carriers.filter((c) => c.origin === b.originCountry && c.destination === b.destCountry);
  }

  /* Score carriers. `feasible` = weight per pallet fits. */
  function rankCarriers(b, carriers, today) {
    const pallets = num(b.pallets), gw = num(b.grossWeight);
    const wpp = isNum(pallets) && pallets > 0 && isNum(gw) ? gw / pallets : NaN;
    const ready = parseDate(b.readyDate), readyDate = ready && today && ready < today ? today : ready; // a past ready date cannot be collected before today
    const opts = carriersFor(b, carriers).map((c) => ({
      ...c,
      total: isNum(pallets) ? r2(pallets * c.pricePerPallet) : NaN,
      ...(() => { const wd = readyDate ? workDays(readyDate, c.transitDays, holidaysFor(b.originCountry, b.destCountry)) : null; return { eta: wd ? wd.date : null, skipped: wd ? wd.skipped : [] }; })(),
      feasible: Number.isFinite(wpp) ? wpp <= c.maxWeightPerPallet : true,
    }));
    return { opts, wpp };
  }

  function pickBest(opts, priority) {
    if (!opts.length) return null;
    const by = (a, b, keys) => { for (const [k, dir] of keys) { if (a[k] !== b[k]) return dir * (a[k] - b[k]); } return 0; };
    const sorted = [...opts];
    if (priority === 'Cheapest') sorted.sort((a, b) => by(a, b, [['total', 1], ['onTime', -1], ['transitDays', 1]]));
    else if (priority === 'Fastest') sorted.sort((a, b) => by(a, b, [['transitDays', 1], ['total', 1], ['onTime', -1]]));
    else if (priority === 'Most reliable') sorted.sort((a, b) => by(a, b, [['onTime', -1], ['total', 1], ['transitDays', 1]]));
    else { // Balanced: minimax regret. regret = (value-best)/(worst-best) per metric; score = max regret; lowest wins.
      const rg = (k, lowerBetter) => { const v = opts.map((o) => o[k]); const best = lowerBetter ? Math.min(...v) : Math.max(...v), worst = lowerBetter ? Math.max(...v) : Math.min(...v);
        return (o) => (worst === best ? 0 : Math.abs(o[k] - best) / Math.abs(worst - best)); };
      const rc = rg('total', true), rt = rg('transitDays', true), ro = rg('onTime', false);
      opts.forEach((o) => { o.regrets = { cost: rc(o), speed: rt(o), reliability: ro(o) }; o.score = Math.max(o.regrets.cost, o.regrets.speed, o.regrets.reliability); o.regretSum = o.regrets.cost + o.regrets.speed + o.regrets.reliability; });
      sorted.sort((a, b) => a.score - b.score || a.regretSum - b.regretSum || a.total - b.total);
    }
    return sorted[0];
  }

  function why(best, opts, priority) {
    const n = opts.length;
    const others = opts.filter((o) => !(o.carrier === best.carrier && o.service === best.service));
    const lead = `${best.carrier} – ${best.service}`;
    const facts = `${gbp(best.total)} total, ${best.transitDays} days, ${best.onTime}% on time`;
    if (n === 1) return `${lead} is the only service on this route that can carry your weight per pallet (${facts}).`;
    const cmp = (f, word) => others.length ? ` ${word}` : '';
    switch (priority) {
      case 'Cheapest': return `${lead} is the cheapest feasible option (${facts}); the next cheapest is ${gbp(Math.min(...others.map((o) => o.total)))}.`;
      case 'Fastest': return `${lead} is the fastest feasible option (${best.transitDays} days; ${facts}).`;
      case 'Most reliable': return `${lead} has the highest on-time rate (${best.onTime}%); ${facts}.`;
      default: return `${lead} is the balanced pick: across the ${n} feasible options it is never the priciest, slowest or least reliable (${facts}).`;
    }
  }

  function checkBooking(b, carriers, today) {
    today = today || todayUTC();
    const F = [];
    const add = (rule, sev, message, fix, item, action) => F.push({ rule, severity: sev, message, fix, item: item || null, action: action || null });
    const items = b.items || [];
    const T = itemTotals(b);

    // R-01 HS code >= 6 digits
    items.forEach((it) => {
      const hs = String(it.hs == null ? '' : it.hs).replace(/[\s.\-]/g, '');
      if (!/^\d{6,}$/.test(hs)) {
        const nd = hs.replace(/\D/g, '').length;
        const lz = /^\d{5}$/.test(hs) ? ` Possible lost leading zero (spreadsheets drop it): did you mean 0${hs}?` : '';
        add('R-01', RED, hs ? `${it.sku}: HS code "${it.hs}" has ${nd} digit${nd === 1 ? '' : 's'}; customs needs at least 6.${lz}` : `${it.sku}: HS code is missing.`,
          'Look up the 6-digit (or longer) HS code for this product (e.g. on the UK Trade Tariff) and add it to the commercial invoice.' + (lz ? ' Store HS codes as text so a leading zero is not lost.' : ''), it.sku,
          lz ? { type: 'setHs', sku: it.sku, value: '0' + hs, label: `Set HS code for ${it.sku} to 0${hs}` } : null);
      }
    });

    // R-02 declared value vs sum(qty*price), within 1%
    if (items.length && isNum(b.declaredValue)) {
      const dv = num(b.declaredValue);
      const diff = Math.abs(dv - T.value);
      if (T.value === 0 ? dv !== 0 : diff / T.value > 0.01) {
        const pct = T.value ? ((diff / T.value) * 100).toFixed(1) : '∞';
        add('R-02', RED, `Declared value ${gbp(dv)} does not match the items: Σ quantity × unit price = ${gbp(r2(T.value))} (off by ${gbp(r2(diff))}, ${pct}%; limit is 1%).`,
          `Either correct the declared value to ${gbp(r2(T.value))} or fix the quantities/unit prices. Customs relies on this figure.`, null, { type: 'setDeclared', value: r2(T.value), label: `Set declared value to ${gbp(r2(T.value))}` });
      }
    } else if (!isNum(b.declaredValue)) {
      add('R-02', RED, 'Total declared value is missing.', `Declare ${gbp(r2(T.value))} (sum of quantity × unit price) if the item lines are right.`, null, { type: 'setDeclared', value: r2(T.value), label: `Set declared value to ${gbp(r2(T.value))}` });
    }

    // R-03 units per carton x cartons == qty
    items.forEach((it) => {
      const q = num(it.qty), u = num(it.upc), c = num(it.cartons);
      if (!isNum(q) || !isNum(u) || !isNum(c) || u * c !== q) {
        const exp = isNum(q) && isNum(u) && u > 0 ? Math.ceil(q / u) : '?';
        add('R-03', RED, `${it.sku}: ${isNum(u) ? u : '?'} units/carton × ${isNum(c) ? c : '?'} cartons = ${isNum(u) && isNum(c) ? u * c : '?'}, but quantity is ${isNum(q) ? q : '?'}.`,
          isNum(q) && isNum(u) && u > 0 ? `If the quantity is right, this item needs ${q % u === 0 ? exp : exp + ' cartons (last carton part-filled – state units per carton for it)'}; otherwise change the quantity to ${isNum(c) && isNum(u) ? u * c : '?'}.` : 'Check quantity, units per carton and cartons.', it.sku,
          isNum(q) && isNum(u) && u > 0 && q % u === 0 ? { type: 'setItemCartons', sku: it.sku, value: q / u, label: `Set ${it.sku} to ${q / u} cartons` } : null);
      }
    });

    // R-04 booking cartons == sum of item cartons
    if (!isNum(b.cartons) || num(b.cartons) !== T.cartons) {
      add('R-04', RED, `Booking says ${isNum(b.cartons) ? num(b.cartons) : '?'} cartons but the item lines add up to ${T.cartons}.`,
        `Set the booking cartons to ${T.cartons}, or correct the item carton counts.`, null, { type: 'setCartons', value: T.cartons, label: `Set booking cartons to ${T.cartons}` });
    }

    // Carrier ranking (also drives R-05)
    const { opts, wpp } = rankCarriers(b, carriers, today);
    const priority = b.priority || 'Balanced';
    const idealAny = pickBest(opts.map((o) => ({ ...o })), priority);          // ignoring weight
    const feasible = opts.filter((o) => o.feasible);
    let best = pickBest(feasible.map((o) => ({ ...o })), priority);
    let palletPlan = null;

    // R-05 weight per pallet vs chosen carrier
    if (!isNum(b.pallets) || num(b.pallets) <= 0) {
      add('R-05', RED, 'Number of pallets is missing or zero, so weight per pallet cannot be checked.', 'State how many pallets are being shipped.');
    } else if (!opts.length) {
      add('R-05', RED, `No carrier on the rate card serves ${b.originCountry} → ${b.destCountry}.`, 'Check the route.');
    } else if (!best) {
      // No carrier can take this weight per pallet: R-05 Red. Fix = more pallets; show pallets needed and cost per carrier.
      const gw = num(b.grossWeight);
      const plan = opts.map((o) => { const n = Math.ceil(gw / o.maxWeightPerPallet); return { ...o, palletsNeeded: n, newTotal: r2(n * o.pricePerPallet) }; });
      const rec = pickBest(plan.map((o) => ({ ...o, total: o.newTotal })), priority);
      palletPlan = { rows: plan.map((o) => ({ carrier: o.carrier, service: o.service, palletsNeeded: o.palletsNeeded, newTotal: o.newTotal, kgPerPallet: Math.round(gw / o.palletsNeeded) })), pick: rec ? `${rec.carrier} ${rec.service}` : null };
      const lines = plan.map((o) => `${o.carrier} – ${o.service}: ${o.palletsNeeded} pallets (${gbp(o.newTotal)})`).join('; ');
      add('R-05', RED, `${Math.round(wpp)} kg per pallet (${gw} kg ÷ ${num(b.pallets)}) is above every carrier's limit (${opts.map((o) => `${o.carrier} ${o.maxWeightPerPallet} kg`).join(', ')}).`,
        `Add pallets so each carries no more than the carrier's limit: ${lines}.` + (rec ? ` For your priority (${priority}) that points to ${rec.carrier} – ${rec.service} with ${rec.palletsNeeded} pallets.` : ''), null,
        rec ? { type: 'setPallets', value: rec.palletsNeeded, label: `Use ${rec.palletsNeeded} pallets (${rec.carrier} – ${rec.service})` } : null);
    }

    // Advisory (never changes the status): the seller's priority would pick a carrier that cannot carry this weight per pallet.
    // Say so, and say what it would take (more pallets) so the trade-off is visible instead of silent.
    if (best && idealAny && isNum(b.grossWeight) && `${idealAny.carrier} ${idealAny.service}` !== `${best.carrier} ${best.service}`) {
      const gw = num(b.grossWeight), n = Math.ceil(gw / idealAny.maxWeightPerPallet), nt = r2(n * idealAny.pricePerPallet);
      add('R-05', 'Info', `Your priority (${priority}) would favour ${idealAny.carrier} – ${idealAny.service}, but it cannot carry ${Math.round(wpp)} kg per pallet (its limit is ${idealAny.maxWeightPerPallet} kg), so ${best.carrier} – ${best.service} is the pick.`,
        `With ${n} pallets (${Math.round(gw / n)} kg each) ${idealAny.carrier} would fit, for ${gbp(nt)} instead of ${gbp(best.total)}. Only worth it if ${priority === 'Cheapest' ? 'cost' : priority === 'Fastest' ? 'speed' : priority === 'Most reliable' ? 'reliability' : 'the balance'} matters more than the extra pallets.`, null,
        { type: 'setPallets', value: n, label: `Use ${n} pallets for ${idealAny.carrier}` });
      F[F.length - 1].title = 'Another carrier would suit your priority better';
    }

    // R-06 dangerous goods: keyword hit = Red with the triggering phrase; vague hits are advisory only (never change status)
    items.forEach((it) => {
      const hit = dgScan(`${it.desc || ''} ${it.sku || ''}`);
      if (!hit) return;
      if (hit.level === 'hard') add('R-06', RED, `${it.sku}: "${it.desc}" – matched "${hit.phrase}" (lithium battery, aerosol or flammable liquid).`, 'Remove it from this shipment or move it to a dangerous-goods-approved service. If this is a false match (for example the product is battery-free), correct the description so the carrier sees the same thing.', it.sku);
      else add('R-06', 'Info', `${it.sku}: "${it.desc}" – "${hit.phrase}" could mean a flammable or pressurised product.`, 'Advisory only: confirm it is not an aerosol or flammable liquid (check the safety data sheet).', it.sku);
    });

    // R-07 gross weight >= sum(unit weight x qty)
    if (isNum(b.grossWeight) && T.weight > 0 && num(b.grossWeight) < T.weight - 1e-9) {
      add('R-07', AMBER, `Gross weight ${num(b.grossWeight)} kg is less than the goods alone (${r2(T.weight)} kg) – cartons and pallets add more.`,
        `Re-weigh. Gross weight must be at least ${r2(T.weight)} kg; including packaging it is usually higher.`, null, { type: 'setGross', value: Math.ceil(T.weight * 1.05), label: `Set gross weight to ${Math.ceil(T.weight * 1.05)} kg (goods plus about 5% packaging)` });
    } else if (!isNum(b.grossWeight)) {
      add('R-07', AMBER, 'Total gross weight is missing.', `It must be at least ${r2(T.weight)} kg (weight of the goods alone).`);
    }

    // R-08 warehouse needs appointment
    if (/warehouse/i.test(b.destType || '') && !/^y/i.test(String(b.appointment || ''))) {
      add('R-08', AMBER, `Delivering to a warehouse in ${b.destCity} with no delivery appointment booked – the carrier may be turned away or charged waiting time.`, 'Book a delivery slot with the receiving warehouse and tick “appointment booked”.', null, { type: 'setAppointment', value: 'Yes', label: 'I have booked the delivery slot' });
    }

    // R-09 country of origin
    items.forEach((it) => {
      if (!String(it.origin || '').trim()) add('R-09', AMBER, `${it.sku}: country of origin is missing.`, 'Add where the product was made (not where it ships from). It affects duty and the commercial invoice.', it.sku);
    });

    // R-10 ready date not in the past
    const rd = parseDate(b.readyDate);
    if (!rd) add('R-10', AMBER, `Ready-to-ship date "${b.readyDate || ''}" is missing or not a valid DD-MM-YYYY date.`, 'Give the day the goods will be packed and ready for collection.');
    else if (rd < today) add('R-10', AMBER, `Ready-to-ship date ${fmtDate(rd)} is in the past.`, 'Pick today or a future date.', null, { type: 'setReady', value: ddmmyyyy(today), label: `Set ready date to today (${ddmmyyyy(today)})` });

    // Status
    const reds = F.filter((f) => f.severity === RED).length, ambers = F.filter((f) => f.severity === AMBER).length;
    const advisories = F.filter((f) => f.severity === 'Info');
    const status = reds ? 'Red' : ambers ? 'Amber' : 'Green';
    const label = reds ? 'Blocked' : ambers ? 'At risk' : 'Ready to book';
    const headline = reds ? `Blocked – fix ${reds} red issue${reds > 1 ? 's' : ''}${ambers ? ` and ${ambers} warning${ambers > 1 ? 's' : ''}` : ''} before collection.`
      : ambers ? `At risk – ${ambers} warning${ambers > 1 ? 's' : ''} could cause delays.` : 'Ready to book.';

    const reason = best ? why(best, feasible, priority) : null;
    const contrast = (o) => { const parts = [], dc = r2(o.total - best.total), dt = o.transitDays - best.transitDays, dr = o.onTime - best.onTime;
      if (dc) parts.push(`${gbp(Math.abs(dc))} ${dc > 0 ? 'more' : 'less'}`); if (dt) parts.push(`${Math.abs(dt)} day${Math.abs(dt) === 1 ? '' : 's'} ${dt < 0 ? 'faster' : 'slower'}`); if (dr) parts.push(`${Math.abs(dr)} point${Math.abs(dr) === 1 ? '' : 's'} ${dr > 0 ? 'more' : 'less'} reliable`);
      return `Not the pick for ${priority}: ${parts.join(', ') || 'same as the pick'} than ${best.carrier} ${best.service}.`; };
    opts.forEach((o) => { o.isPick = !!best && o.carrier === best.carrier && o.service === best.service;
      o.verdict = !o.feasible ? `Cannot carry ${Math.round(wpp)} kg per pallet; its limit is ${o.maxWeightPerPallet} kg.` : o.isPick ? reason : best ? contrast(o) : ''; });

    const recommendation = best ? {
      carrier: best.carrier, service: best.service, total: best.total, transitDays: best.transitDays, onTime: best.onTime,
      eta: best.eta ? fmtDate(best.eta) : null, etaDate: best.eta ? isoDay(best.eta) : null, skipped: best.skipped, reason,
      note: opts.some((o) => !o.feasible) ? opts.filter((o) => !o.feasible).map((o) => `${o.carrier} excluded: ${Math.round(wpp)} kg per pallet exceeds its ${o.maxWeightPerPallet} kg limit.`).join(' ') : null,
    } : null;

    return { id: b.id, status, label, advisories, headline, palletPlan, findings: F.filter((f) => f.severity !== 'Info'), options: opts, recommendation, totals: { value: r2(T.value), weight: r2(T.weight), cartons: T.cartons, weightPerPallet: Number.isFinite(wpp) ? Math.round(wpp * 10) / 10 : null } };
  }

  function confirmationText(b, res) {
    if (res.status === 'Red') return `Booking ${b.id || ''} is on hold. Fix the red items above, then we'll book it – nothing has been sent to the carrier.`;
    const r = res.recommendation;
    if (!r) return `Booking ${b.id || ''} passed the checks but no carrier option was found for this route.`;
    const warn = res.status === 'Amber' ? ' Review the warnings first – they will not stop the shipment but can cause delays.' : '';
    return `Booking ${b.id || ''} is ready. ${b.pallets} pallet(s) collected from ${b.originCity} on ${b.readyDate}, shipping with ${r.carrier} – ${r.service} for ${gbp(r.total)}, arriving around ${r.eta} in ${b.destCity}.${warn} Next: the carrier confirms collection, you receive the label and invoice pack, and tracking starts at pickup.`;
  }


  const PLAIN = { Red: "Can't ship yet", Amber: 'Ship with care', Green: 'Good to go' };
  const passedCount = (res) => 10 - new Set(res.findings.map((f) => f.rule)).size;

  /* Apply one fix action (from finding.action) and return a corrected copy of the booking. */
  function applyFix(b, a) {
    const c = { ...b, items: (b.items || []).map((x) => ({ ...x })) }, it = c.items.find((x) => x.sku === a.sku);
    switch (a.type) {
      case 'setHs': if (it) it.hs = a.value; break;
      case 'setItemCartons': if (it) it.cartons = a.value; break;
      case 'setDeclared': c.declaredValue = a.value; break;
      case 'setCartons': c.cartons = a.value; break;
      case 'setPallets': c.pallets = a.value; break;
      case 'setGross': c.grossWeight = a.value; break;
      case 'setAppointment': c.appointment = a.value; break;
      case 'setReady': c.readyDate = a.value; break;
    }
    return c;
  }

  /* Paperwork: the 10 things an export invoice needs (business.gov.uk "How to create an export invoice"),
     what we already hold, and the rules on each side of the border (reference only). */
  const COUNTRY = {
    Germany: { customs: 'German customs (Zoll)', vat: '19%', reduced: '7%' },
    France: { customs: 'French customs (DGDDI)', vat: '20%', reduced: '5.5% or 10%' },
    Netherlands: { customs: 'Dutch customs (Douane)', vat: '21%', reduced: '9%' },
  };
  function paperwork(b, res) {
    const has = (r) => !res.findings.some((f) => f.rule === r), items = b.items || [];
    const st = (ok, partial) => (ok ? (partial ? 'check' : 'have') : 'check');
    const inv = [
      ['Parties’ details', 'Full names, addresses and contact details of seller and buyer.', 'add', b.seller ? `Seller on file: ${b.seller}. Add both addresses and contacts.` : 'Add seller and buyer names, addresses and contacts.'],
      ['Invoice number and date', 'The commercial invoice reference and issue date.', 'add', 'Use your own invoice numbering.'],
      ['Related document reference', 'Proforma invoice, purchase order or sales contract number and date.', 'add', 'Quote the purchase order the buyer sent you.'],
      ['Price and commercial terms', 'Price, payment method, currency, discounts and extra charges.', items.every((i) => isNum(i.unitPrice)) && has('R-02') ? 'have' : 'check', 'Unit prices and GBP are on file; add the payment method and any discount.'],
      ['Quantities, weights and packages', 'Quantity, gross and net weight, number and type of packages.', has('R-03') && has('R-04') && has('R-07') ? 'have' : 'check', `${b.pallets} pallet(s), ${b.cartons} cartons, ${b.grossWeight} kg gross, ${res.totals.weight} kg net (goods).`],
      ['Product classification', 'HS tariff code and a plain-language description of each product.', has('R-01') && items.every((i) => String(i.desc || '').trim()) ? 'have' : 'check', 'Every product needs a 6-digit-or-longer HS code and a plain description.'],
      ['Delivery and payment terms', 'The Incoterms, for example DAP (buyer pays duty and VAT) or DDP (you pay).', 'add', 'Agree this with the buyer; it decides who pays duty and import VAT.'],
      ['Country of origin', 'The country where each product was produced.', has('R-09') ? 'have' : 'check', 'Where it was made, not where it ships from.'],
      ['Transport', 'Means of transport and route.', res.recommendation ? 'have' : 'check', res.recommendation ? `Road freight, ${b.originCity} to ${b.destCity}.` : 'Needs a carrier once the weight per pallet fits.'],
      ['Value of the goods', 'The actual value, which customs checks against the products.', has('R-02') ? 'have' : 'check', `${gbp(Number(b.declaredValue) || 0)} declared.`],
    ].map(([title, detail, status, note], i) => ({ n: i + 1, title, detail, status, note }));
    const c = COUNTRY[b.destCountry] || { customs: 'customs in the destination country', vat: 'the local standard rate', reduced: 'a reduced rate' };
    const far = [...new Set(items.map((i) => String(i.origin || '').trim()).filter((o) => o && !/^(united kingdom|uk|germany|france|netherlands)$/i.test(o)))];
    return {
      invoice: inv,
      counts: { have: inv.filter((x) => x.status === 'have').length, check: inv.filter((x) => x.status === 'check').length, add: inv.filter((x) => x.status === 'add').length },
      exportRules: ['You need a GB EORI number (starts with GB) to export.', 'Make a UK export declaration, or have your freight forwarder or customs agent make it.', 'Check whether any product needs an export licence or certificate (for example chemicals, animals or firearms).', 'The commercial invoice and any licences travel with the goods. Keep copies of your invoices and customs paperwork.'],
      importRules: [`Your buyer needs an EU EORI number; the goods are cleared by ${c.customs}.`, `Import VAT is charged at ${b.destCountry || 'the destination'}'s rate (standard ${c.vat}; some goods ${c.reduced}). Who pays it, and any duty, depends on the Incoterms you agree.`,
        far.length ? `Goods made in ${far.join(', ')} are unlikely to get the UK-EU zero tariff; the EU duty for their HS code applies.` : 'UK-made goods that meet the rules of origin can qualify for the UK-EU zero tariff. Keep proof of origin.'],
      links: [['UK guide to exporting goods', 'https://www.gov.uk/export-goods'], ['How to create an export invoice', 'https://www.business.gov.uk/export-from-uk/advice/manage-payment-for-export-orders/how-to-create-an-export-invoice']],
    };
  }

  /* Rows for a draft commercial invoice (.xlsx). Anything we do not hold is left for the seller to fill in. */
  function invoiceRows(b, res) {
    const items = b.items || [], rec = res.recommendation, rows = [];
    rows.push(['DRAFT COMMERCIAL INVOICE (check every field before use)'], [], ['Invoice number', '', 'Invoice date', ''], ['Seller', b.seller || '', 'Seller address and contact', ''], ['Buyer', '', 'Buyer address and contact', ''],
      ['Related PO or contract', '', 'Incoterms (e.g. DAP, DDP)', ''], ['Payment method', '', 'Currency', 'GBP'], ['Booking ID', b.id || '', 'Ready date', b.readyDate || ''],
      ['From', `${b.originCity}, ${b.originCountry}`, 'To', `${b.destCity}, ${b.destCountry}`], ['Transport', rec ? `Road freight, ${rec.carrier} ${rec.service}` : 'Road freight', 'Packages', `${b.pallets} pallet(s), ${b.cartons} cartons`], [],
      ['SKU', 'Description', 'HS code', 'Country of origin', 'Quantity', 'Unit price (GBP)', 'Line value (GBP)', 'Unit weight (kg)', 'Net weight (kg)']);
    items.forEach((i) => { const q = num(i.qty), p = num(i.unitPrice), w = num(i.unitWeight); rows.push([i.sku, i.desc, String(i.hs == null ? '' : i.hs), i.origin || '', q, p, isNum(q) && isNum(p) ? r2(q * p) : '', isNum(w) ? w : '', isNum(q) && isNum(w) ? r2(q * w) : '']); });
    rows.push([], ['', '', '', '', '', 'Total value (GBP)', res.totals.value, 'Net weight (kg)', res.totals.weight], ['', '', '', '', '', 'Declared value (GBP)', num(b.declaredValue), 'Gross weight (kg)', num(b.grossWeight)]);
    return rows;
  }

  const api = { PLAIN, passedCount, applyFix, paperwork, invoiceRows, holidaysFor, workDays, addWorkDays, checkBooking, confirmationText, rankCarriers, pickBest, parseDate, fmtDate, num, isNum, gbp, itemTotals, dgScan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis);
