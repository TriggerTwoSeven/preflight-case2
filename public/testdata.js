/* Test data for the page and the tests: one planted error per rule plus the special cases. UMD, no dependencies. */
(function (root) {
  const BH = ['Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city', 'Destination country', 'Destination type', 'Ready to ship date', 'Seller priority', 'Pallets', 'Cartons', 'Total declared value', 'Currency', 'Total gross weight (kg)', 'Delivery appointment booked'];
  const IH = ['Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price', 'Units per carton', 'Cartons', 'Unit weight (kg)', 'Country of origin'];
  const pad = (n) => String(n).padStart(2, '0');
  const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; };
  const SELLERS = ['Northfield Goods', 'Spice & Co', 'Brightside Homeware', 'Leeds Living', 'Pennine Textiles', 'Mersey Glassworks', 'Oakline Furniture', 'Thames Tea Co', 'Cotswold Ceramics', 'Harbour Prints'];
  const CITIES = ['Manchester', 'London', 'Birmingham', 'Leeds'];
  const bk = (id, o = {}) => { const d = { city: CITIES[(+id.slice(3) || 0) % 4], dest: 'Frankfurt', country: 'Germany', type: 'Warehouse', date: inDays(10), pr: 'Cheapest', pal: 3, car: 90, val: 5400, gw: 620, appt: 'Yes', ...o };
    return [id, SELLERS[(+id.slice(3) || 0) % SELLERS.length], d.city, 'United Kingdom', d.dest, d.country, d.type, d.date, d.pr, d.pal, d.car, d.val, 'GBP', d.gw, d.appt]; };
  const mug = (id, o = {}) => { const d = { sku: 'MUG-01', desc: 'Ceramic coffee mug, 350 ml', hs: '691200', qty: 1080, price: 5, upc: 12, car: 90, w: 0.5, org: 'United Kingdom', ...o }; return [id, d.sku, d.desc, d.hs, d.qty, d.price, d.upc, d.car, d.w, d.org]; };
  // [id, booking overrides, items (overrides each), expected]
  const CASES = [
    ['BK-001', {}, [{}], 'Ready to book. Carrier A, £540'],
    ['BK-101', {}, [{ hs: '' }], 'Blocked: R-01 (HS missing)'],
    ['BK-102', {}, [{ hs: '69120' }], 'Blocked: R-01 (5 digits, lost leading zero)'],
    ['BK-103', { val: 5000 }, [{}], 'Blocked: R-02 (7.4% gap)'],
    ['BK-104', { val: 5443 }, [{}], 'Ready to book (0.8% gap is inside 1%)'],
    ['BK-105', {}, [{ car: 80 }], 'Blocked: R-03 and R-04'],
    ['BK-106', { car: 95 }, [{}], 'Blocked: R-04'],
    ['BK-107', { gw: 2400 }, [{}], 'Blocked: R-05. B 4 pallets £880, A 5 £900, C 6 £2,040'],
    ['BK-108', {}, [{ desc: 'Lithium power bank 10000 mAh' }], 'Blocked: R-06'],
    ['BK-109', {}, [{ desc: 'Battery-free wall clock' }], 'Ready to book (no false match)'],
    ['BK-110', { gw: 500 }, [{}], 'At risk: R-07'],
    ['BK-111', { appt: 'No' }, [{}], 'At risk: R-08'],
    ['BK-112', {}, [{ org: '' }], 'At risk: R-09'],
    ['BK-113', { date: '01-10-2026' }, [{}], 'At risk: R-10'],
    ['BK-114', { gw: 1350, pr: 'Fastest' }, [{}], 'Ready to book. 450 kg per pallet, Fastest falls back to Carrier B'],
    ['BK-115', { gw: 1350, pr: 'Cheapest' }, [{}], 'Ready to book. Carrier A'],
    ['BK-116', { pr: 'Balanced' }, [{}], 'Ready to book. Carrier B (minimax regret)'],
    ['BK-117', { gw: 1800, pr: 'Cheapest' }, [{}], 'Ready to book. 600 kg per pallet, only Carrier B fits'],
    ['BK-118', {}, [], 'Blocked: no item lines'],
  ];
  function sheets(withExpected) {
    const B = [['Pre-Flight test file: one planted mistake per rule'], BH], I = [['Pre-Flight test file'], IH], E = [['Booking ID', 'Expected result']];
    for (const [id, bo, items, exp] of CASES) { B.push(bk(id, bo)); items.forEach((it, i) => I.push(mug(id, { sku: 'ITEM-' + (i + 1), ...it }))); E.push([id, exp]); }
    I.push(mug('BK-999', { sku: 'ORPHAN' })); E.push(['BK-999', 'Item with no booking: reported as a data issue']);
    return withExpected ? { Bookings: B, Items: I, Expected: E } : { Bookings: B, Items: I };
  }
  const template = () => ({ Bookings: [['Pre-Flight template: one booking per row, its items on the Items sheet'], BH, bk('BK-001')], Items: [['Pre-Flight template'], IH, mug('BK-001')] });
  /* Rebuild the two sheets from bookings (used for the "corrected file" download after one-click fixes). */
  const fromBookings = (list) => { const B = [['Pre-Flight corrected file'], BH], I = [['Pre-Flight corrected file'], IH];
    for (const b of list) { B.push([b.id, b.seller, b.originCity, b.originCountry, b.destCity, b.destCountry, b.destType, b.readyDate, b.priority, b.pallets, b.cartons, b.declaredValue, b.currency || 'GBP', b.grossWeight, b.appointment]);
      (b.items || []).forEach((i) => I.push([b.id, i.sku, i.desc, i.hs == null ? '' : String(i.hs), i.qty, i.unitPrice, i.upc, i.cartons, i.unitWeight, i.origin])); }
    return { Bookings: B, Items: I }; };
  const api = { CASES, sheets, template, inDays, fromBookings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TestData = api;
})(typeof self !== 'undefined' ? self : globalThis);
