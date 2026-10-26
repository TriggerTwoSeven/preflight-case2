/* Minimal .xlsx reader (browser): returns { sheetName: rows[][] }. Replaces the 880 KB SheetJS build.
   shortcut: .xlsx only (no .xls/.csv), no formula evaluation (reads cached values), upgrade to SheetJS if those are needed. */
async function readXlsx(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This does not look like an .xlsx file.');
  const files = {}; let p = dv.getUint32(e + 16, true);
  for (let n = dv.getUint16(e + 10, true); n > 0; n--) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, off }; p += 46 + nl + xl + cl;
  }
  const text = async (name) => {
    const f = files[name]; if (!f) return null;
    const s = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), raw = u8.subarray(s, s + f.csize);
    if (f.method === 0) return td.decode(raw);
    const ds = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    return td.decode(await ds.arrayBuffer());
  };
  const xml = async (name) => { const t = await text(name); return t == null ? null : new DOMParser().parseFromString(t, 'application/xml'); };
  const all = (node, tag) => [...node.getElementsByTagName(tag)];
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels'), sst = await xml('xl/sharedStrings.xml');
  const strings = sst ? all(sst, 'si').map((si) => all(si, 't').map((t) => t.textContent).join('')) : [];
  const target = {}; all(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const col = (ref) => ref.replace(/\d+/g, '').split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const out = {};
  for (const s of all(wb, 'sheet')) {
    const t = target[s.getAttribute('r:id')] || target[s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')];
    const doc = await xml('xl/' + String(t).replace(/^\/?(xl\/)?/, '')); const rows = [];
    for (const c of all(doc, 'c')) {
      const ref = c.getAttribute('r'), r = +ref.replace(/\D/g, '') - 1, k = col(ref), ty = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]; let val = '';
      if (ty === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
      else if (v) val = ty === 's' ? strings[+v.textContent] : ty === 'str' || ty === 'e' ? v.textContent : ty === 'b' ? v.textContent === '1' : Number(v.textContent);
      (rows[r] = rows[r] || [])[k] = val;
    }
    for (let i = 0; i < rows.length; i++) { rows[i] = rows[i] || []; for (let j = 0; j < rows[i].length; j++) if (rows[i][j] === undefined) rows[i][j] = ''; }
    out[s.getAttribute('name')] = rows;
  }
  return out;
}

/* Minimal .xlsx writer: sheets = { name: rows[][] } -> Uint8Array (stored zip, inline strings). Used for the downloadable test file and template. */
function writeXlsx(sheets) {
  const te = new TextEncoder(), names = Object.keys(sheets);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const sheetXml = (rows) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((r, i) => `<row r="${i + 1}">` + r.map((v, j) => v === '' || v == null ? '' : typeof v === 'number' ? `<c r="${colName(j)}${i + 1}"><v>${v}</v></c>` : `<c r="${colName(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>',
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]); });
  const T = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = te.encode(name), d = te.encode(text), c = crc(d);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, c, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, nb.length, true);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, c, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nb, d); central.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + d.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length / 2, true); end.setUint16(10, central.length / 2, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(off + cdSize + 22); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
if (typeof module !== 'undefined') module.exports = { readXlsx, writeXlsx };
