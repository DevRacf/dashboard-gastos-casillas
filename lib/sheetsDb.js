// Capa de acceso a datos sobre Google Sheets: reemplaza al cliente de Supabase.
// La hoja debe tener el encabezado id | tipo | fecha | concepto | monto | categoria
// en la fila 1, y estar compartida como Editor con la cuenta de servicio.

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'transactions';
const HEADERS = ['id', 'tipo', 'fecha', 'concepto', 'monto', 'categoria'];
const DATA_RANGE = `${SHEET_NAME}!A2:F`;

let sheetsApiPromise = null;
let sheetGridIdPromise = null;

function getSheetsApi() {
  if (!sheetsApiPromise) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
    sheetsApiPromise = Promise.resolve(google.sheets({ version: 'v4', auth }));
  }
  return sheetsApiPromise;
}

async function getSheetGridId() {
  if (!sheetGridIdPromise) {
    sheetGridIdPromise = (async () => {
      const sheets = await getSheetsApi();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
      if (!sheet) throw new Error(`No se encontró la hoja "${SHEET_NAME}" en el spreadsheet configurado.`);
      return sheet.properties.sheetId;
    })();
  }
  return sheetGridIdPromise;
}

function rowToRecord(row, rowNumber) {
  return {
    rowNumber,
    id: parseInt(row[0], 10),
    tipo: row[1] || '',
    fecha: row[2] || '',
    concepto: row[3] || '',
    monto: parseFloat(row[4]) || 0,
    categoria: row[5] || ''
  };
}

function recordToRow(record) {
  return [record.id, record.tipo, record.fecha, record.concepto, record.monto, record.categoria];
}

// Devuelve solo los campos públicos, sin el rowNumber interno.
function toPublic({ id, tipo, fecha, concepto, monto, categoria }) {
  return { id, tipo, fecha, concepto, monto, categoria };
}

async function ensureHeader() {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:F1`
  });
  const row = (res.data.values && res.data.values[0]) || [];
  if (row.join() !== HEADERS.join()) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:F1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] }
    });
  }
}

async function getAllRows() {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: DATA_RANGE
  });
  const values = res.data.values || [];
  return values
    .map((row, i) => rowToRecord(row, i + 2))
    .filter(r => Number.isInteger(r.id));
}

async function insert({ tipo, fecha, concepto, monto, categoria }) {
  const sheets = await getSheetsApi();
  const rows = await getAllRows();
  const nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const record = { id: nextId, tipo, fecha, concepto, monto, categoria };

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: DATA_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [recordToRow(record)] }
  });

  return toPublic(record);
}

async function update(id, { tipo, fecha, concepto, monto, categoria }) {
  const rows = await getAllRows();
  const existing = rows.find(r => r.id === id);
  if (!existing) return null;

  const record = { id, tipo, fecha, concepto, monto, categoria };
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${existing.rowNumber}:F${existing.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [recordToRow(record)] }
  });

  return toPublic(record);
}

async function remove(id) {
  const rows = await getAllRows();
  const existing = rows.find(r => r.id === id);
  if (!existing) return null;

  const sheets = await getSheetsApi();
  const gridId = await getSheetGridId();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: gridId,
            dimension: 'ROWS',
            startIndex: existing.rowNumber - 1,
            endIndex: existing.rowNumber
          }
        }
      }]
    }
  });

  return toPublic(existing);
}

module.exports = {
  SPREADSHEET_ID,
  SHEET_NAME,
  HEADERS,
  ensureHeader,
  getAllRows: async () => (await getAllRows()).map(toPublic),
  insert,
  update,
  remove
};
