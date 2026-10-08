const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const dataDir = path.join(__dirname, '../data');
const outputFile = path.join(__dirname, '../data/master-data.json');

const IGNORED_STATUSES = ['received_at_ph', 'received_at_seller'];

function isInvalid(val) {
  if (!val) return true;
  const clean = String(val).trim().toUpperCase();
  return clean === '#N/A' || clean === 'N/A' || clean === 'NA' || clean === '#VALUE!' || clean === 'UNKNOWN ZONE' || clean === 'UNASSIGNED' || clean.startsWith('UNASSIGNED');
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

function getWeekIdentifier(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `Week ${weekNo}, ${d.getUTCFullYear()}`;
}

async function run() {
  console.log('Starting CSV consolidation...');
  
  if (!fs.existsSync(dataDir)) {
    console.error('Data directory does not exist!');
    process.exit(1);
  }

  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));
  const seenIds = new Set();
  const masterData = [];

  files.forEach(file => {
    const filePath = path.join(dataDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });

    parsed.data.forEach(row => {
      // Handles ShipmentId or Shipment ID variations
      const id = row['ShipmentId'] || row['Shipment ID'];
      if (id && !seenIds.has(id)) {
        const dtStr = row['Date'] || row['date'] || '';
        const pd = parseDateStrFast(dtStr);
        const status = cleanVal(row['Status'] || row['Shipment Status'], 'Unknown Status');

        if (!IGNORED_STATUSES.includes(status)) {
          seenIds.add(id);
          masterData.push({
            Date: dtStr || 'Unassigned Date',
            ParsedDate: pd ? pd.toISOString() : null,
            Month: pd ? pd.toLocaleString('default', { month: 'long', year: 'numeric' }) : null,
            Week: pd ? getWeekIdentifier(pd) : null,
            ShipmentId: id,
            HubName: cleanVal(row['Hub Name'] || row['PH Name'], 'Unassigned'),
            SellerName: cleanVal(row['Seller name'], 'Unknown Seller'),
            SellerId: cleanVal(row['seller id'], 'None'),
            Status: status,
            Zone: cleanVal(row['Zone'], 'Unknown Zone'),
            LOB: cleanVal(row['LIB'] || row['LOB'], 'Unassigned'),
            CasperId: cleanVal(row['Casper id'], 'None'),
            PartnerName: cleanVal(row['Partner Name'], 'None'),
            WM: cleanVal(row['WM name'], 'Unassigned WM'),
            MH: cleanVal(row['MH'], 'Unassigned MH'),
            RCA: cleanVal(row['RCA'], 'None'),
            BagId: cleanVal(row['BagId'], 'None'),
            BagStatus: cleanVal(row['Bag status'], 'None'),
            BagReceiveTime: cleanVal(row['Bag Receive time'], 'None'),
            GM: cleanVal(row['GM'], 'Unassigned GM'),
            DispatchToMH: cleanVal(row['Dispatch to MH'], 'None'),
            ReceivedAtMH: cleanVal(row['Received at MH'], 'None'),
            Diff: cleanVal(row['Diff'], '0'),
            Hrs: cleanVal(row['Hrs'], '0')
          });
        }
      }
    });
  });

  fs.writeFileSync(outputFile, JSON.stringify(masterData, null, 0));
  console.log(`Successfully compiled ${masterData.length} records into ${outputFile}`);
}

run();
