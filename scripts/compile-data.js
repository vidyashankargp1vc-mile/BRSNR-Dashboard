const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const dataDir = path.join(__dirname, '../data');
const mappingFile = path.join(__dirname, '../data/hub-mapping.csv');

const IGNORED_STATUSES = ['received_at_ph', 'received_at_seller'];

function isInvalid(val) {
  if (!val) return true;
  const clean = String(val).trim().toUpperCase();
  return (
    clean === '#N/A' || clean === 'N/A' || clean === 'NA' ||
    clean === '#VALUE!' || clean === 'UNKNOWN ZONE' ||
    clean === 'UNASSIGNED' || clean.startsWith('UNASSIGNED')
  );
}

function cleanVal(val, defaultVal = 'Unassigned') {
  return isInvalid(val) ? defaultVal : String(val).trim();
}

function parseDateStrFast(str) {
  if (!str) return null;
  const p = str.split(/[-/]/);
  if (p.length === 3) {
    return p[0].length === 4
      ? new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]))
      : new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  }
  const nativeDate = Date.parse(str);
  return !isNaN(nativeDate) ? new Date(nativeDate) : null;
}

function formatDateISO(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthKey(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return 'unknown-month';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`; // e.g., "2026-10"
}

function loadHubMapping() {
  const hubToGM = {};
  if (!fs.existsSync(mappingFile)) return hubToGM;
  const content = fs.readFileSync(mappingFile, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  parsed.data.forEach(row => {
    const hub = row['ph_name'] || row['Hub'] || row['PH Name'];
    const gm = row['GM'];
    if (hub && gm) hubToGM[hub.trim().toLowerCase()] = gm.trim();
  });
  return hubToGM;
}

async function run() {
  console.log('Starting CSV consolidation by month...');
  if (!fs.existsSync(dataDir)) process.exit(1);

  const hubMap = loadHubMapping();
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv') && f !== 'hub-mapping.csv');
  const seenIds = new Set();
  const monthlyRecords = {}; // { "2026-10": [records...] }
  const gmShipments = {};

  files.forEach(file => {
    const filePath = path.join(dataDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });

    parsed.data.forEach(row => {
      // 1. Daily shipment baseline files
      if (row['Shipment'] !== undefined || row['shipment'] !== undefined) {
        const hubRaw = row['Hub'] || row['ph_name'] || row['PH Name'] || '';
        const rawDateStr = row['Date'] || row['date'] || '';
        const parsedDt = parseDateStrFast(rawDateStr);
        const normDateStr = parsedDt ? formatDateISO(parsedDt) : rawDateStr;
        const shipmentVal = parseFloat(row['Shipment'] || row['shipment']) || 0;
        const gm = hubMap[hubRaw.trim().toLowerCase()] || row['GM'];

        if (gm && normDateStr) {
          const cleanGM = cleanVal(gm, 'Unassigned GM');
          if (!gmShipments[cleanGM]) gmShipments[cleanGM] = {};
          gmShipments[cleanGM][normDateStr] = (gmShipments[cleanGM][normDateStr] || 0) + shipmentVal;
        }
      }

      // 2. Main BRSNR records
      const id = row['ShipmentId'] || row['Shipment ID'];
      if (id && !seenIds.has(id)) {
        const dtStr = row['Date'] || row['date'] || '';
        const pd = parseDateStrFast(dtStr);
        const status = cleanVal(row['Status'] || row['Shipment Status'], 'Unknown Status');

        if (!IGNORED_STATUSES.includes(status)) {
          seenIds.add(id);
          const monthKey = getMonthKey(pd);
          if (!monthlyRecords[monthKey]) monthlyRecords[monthKey] = [];

          monthlyRecords[monthKey].push({
            Date: dtStr || 'Unassigned Date',
            ParsedDate: pd ? pd.toISOString() : null,
            Month: pd ? pd.toLocaleString('default', { month: 'long', year: 'numeric' }) : null,
            ShipmentId: id,
            HubName: cleanVal(row['Hub Name'] || row['PH Name'], 'Unassigned'),
            SellerName: cleanVal(row['seller_name'] || row['Seller name'], 'Unknown Seller'),
            Status: status,
            Zone: cleanVal(row['Zone'], 'Unknown Zone'),
            LOB: cleanVal(row['Line_of_Business'] || row['LIB'] || row['LOB'], 'Unassigned'),
            WM: cleanVal(row['FE_Name'] || row['WM name'], 'Unassigned WM / FE'),
            MH: cleanVal(row['MH Name'] || row['MH'], 'Unassigned MH'),
            RCA: cleanVal(row['RCA'], 'None'),
            GM: cleanVal(row['GM'], 'Unassigned GM'),
            RM: cleanVal(row['RM'], 'None'),
            AM: cleanVal(row['AM'], 'None')
          });
        }
      }
    });
  });

  // Write out a separate file per month + an index manifest file
  const manifest = [];
  Object.keys(monthlyRecords).forEach(monthKey => {
    const fileName = `master-data-${monthKey}.json`;
    const filePath = path.join(dataDir, fileName);
    const payload = {
      month: monthKey,
      records: monthlyRecords[monthKey],
      gmShipments: gmShipments
    };
    fs.writeFileSync(filePath, JSON.stringify(payload));
    manifest.push(fileName);
    console.log(`Compiled ${monthlyRecords[monthKey].length} records into ${fileName}`);
  });

  // Write a manifest file so the frontend knows which month files exist
  fs.writeFileSync(path.join(dataDir, 'master-manifest.json'), JSON.stringify(manifest));
}

run();
