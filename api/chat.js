// Optional LLM extractor. If GEMINI_API_KEY is not set, or anything fails / is rate limited,
// we answer {fallback:true} and the browser uses its rule-based parser. Judges never see an error.
const hits = new Map();
// Keys: GEMINI_API_KEYS (comma, space or newline separated, any number) and/or the original GEMINI_API_KEY.
// Rotating a key = add the new one, deploy, then remove the old one. A key that fails is skipped for a minute.
const readKeys = () => [...new Set(`${process.env.GEMINI_API_KEYS || ''},${process.env.GEMINI_API_KEY || ''}`.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))];
const cooling = new Map(); let cursor = 0;
const COOL = 60_000;
const LIMIT = 40, WINDOW = 60_000; // per IP per minute (protects the key / spend)

const SYSTEM = `You extract a shipment booking from a seller's chat messages.
Return ONLY a JSON object: the UPDATED draft. Keep every field from the current draft unless the latest message changes or corrects it
(e.g. "add a pallet" => pallets + 1; "make it fastest" => priority "Fastest"; "send to Hamburg instead" => destCity "Hamburg").
Never invent values the seller has not said or clearly implied; use null for unknown.
Schema: {originCity, destCity, destType ("Warehouse"|"Business address"), readyDate ("DD-MM-YYYY"), priority ("Cheapest"|"Fastest"|"Most reliable"|"Balanced"),
pallets (number), cartons (number|null), declaredValue (number|null), grossWeight (number, kg), appointment ("Yes"|"No"|null),
items: [{sku, desc, hs, qty, unitPrice (GBP), upc (units per carton), cartons, unitWeight (kg), origin (one of United Kingdom, China, India, Vietnam, Turkey, Germany)}],
skip: {}} .
Allowed origin cities: London, Manchester, Birmingham, Leeds. Allowed destination cities: Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam, Rotterdam.
Currency is always GBP. Dates are UK style DD-MM-YYYY; resolve relative dates from TODAY given below. If the seller says they don't know an HS code or origin for a product, set draft.skip["hs:<description>"]=true or draft.skip["origin:<description>"]=true (use the item description, or the sku if there is no description).
Do not compute totals; the application does that. Output JSON only, no prose.`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ fallback: true }));
    const keys = readKeys();
    if (!keys.length) return res.status(200).end(JSON.stringify({ fallback: true, reason: 'no-key' }));

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
    const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
    if (arr.length >= LIMIT) return res.status(200).end(JSON.stringify({ fallback: true, reason: 'rate' }));
    arr.push(now); hits.set(ip, arr);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const message = String(body.message || '').slice(0, 2000);
    const draft = body.draft || {};
    const history = Array.isArray(body.history) ? body.history.slice(-8).map((h) => ({ role: h.role === 'bot' ? 'model' : 'user', parts: [{ text: String(h.text || '').slice(0, 1500) }] })) : [];
    const today = new Date().toISOString().slice(0, 10);
    // Gemini wants alternating roles starting with 'user'; the current draft + latest message go in the final user turn.
    const contents = [...history, { role: 'user', parts: [{ text: `CURRENT DRAFT:\n${JSON.stringify(draft)}\n\nLATEST MESSAGE:\n${message}` }] }];
    while (contents.length > 1 && contents[0].role !== 'user') contents.shift();

    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash'; // set GEMINI_MODEL in Vercel to change it without a redeploy
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM}\nTODAY: ${today}` }] }, contents,
      generationConfig: { temperature: 0, maxOutputTokens: 1500, responseMimeType: 'application/json' },
    });
    const deadline = Date.now() + 9000, begin = cursor++ % keys.length;
    let j = null, lastStatus = 0;
    for (let n = 0; n < keys.length && !j; n++) {
      const key = keys[(begin + n) % keys.length], left = deadline - Date.now();
      if (left < 800) break;
      if ((cooling.get(key) || 0) > Date.now() && n < keys.length - 1) continue; // recently failed: try the next key first
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), left);
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: payload,
        });
        lastStatus = r.status;
        if (r.ok) { j = await r.json(); cooling.delete(key); } else cooling.set(key, Date.now() + COOL); // revoked, over quota or wrong: move to the next key
      } catch (e) { cooling.set(key, Date.now() + 5000); } finally { clearTimeout(to); }
    }
    if (!j) return res.status(200).end(JSON.stringify({ fallback: true, reason: 'upstream-' + (lastStatus || 'timeout') }));
    const text = ((j.candidates || [])[0]?.content?.parts || []).map((c) => c.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(200).end(JSON.stringify({ fallback: true, reason: 'parse' }));
    return res.status(200).end(JSON.stringify({ draft: JSON.parse(m[0]) }));
  } catch (e) {
    return res.status(200).end(JSON.stringify({ fallback: true, reason: 'error' }));
  }
};
