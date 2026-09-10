// Escribe las transacciones en la hoja de Google Sheets configurada.
//
// Por defecto lee data/db.json (el seed original del proyecto). Si además
// defines SUPABASE_URL y SUPABASE_SERVICE_KEY en el entorno (mientras tu
// proyecto de Supabase siga accesible), el script intentará leer ahí primero
// para capturar transacciones agregadas desde la app después del seed.
//
// Uso:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_PRIVATE_KEY=... GOOGLE_SHEET_ID=... \
//     node google-sheets/migrate.js
//
// Para leer desde Supabase primero necesitas instalar el cliente (no es
// dependencia del proyecto porque el servidor ya no lo usa):
//   npm install @supabase/supabase-js --no-save
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... GOOGLE_SERVICE_ACCOUNT_EMAIL=... \
//     GOOGLE_PRIVATE_KEY=... GOOGLE_SHEET_ID=... node google-sheets/migrate.js

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'transactions';
const HEADERS = ['id', 'tipo', 'fecha', 'concepto', 'monto', 'categoria'];

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !SPREADSHEET_ID) {
  console.error('Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY y/o GOOGLE_SHEET_ID en el entorno.');
  process.exit(1);
}

async function loadTransactions() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data, error } = await supabase.from('transactions').select('*').order('id', { ascending: true });
      if (error) throw error;
      console.log(`Leyendo ${data.length} transacciones desde Supabase...`);
      return data;
    } catch (err) {
      console.warn(`⚠️  No se pudo leer de Supabase (${err.message}). Usando data/db.json en su lugar.`);
    }
  }

  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  const { transactions } = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  console.log(`Leyendo ${transactions.length} transacciones desde data/db.json...`);
  return transactions;
}

async function main() {
  const transactions = await loadTransactions();

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = transactions.map(({ id, tipo, fecha, concepto, monto, categoria }) => [
    id, tipo, fecha, concepto, monto, categoria
  ]);

  console.log(`Escribiendo ${rows.length} filas en la hoja "${SHEET_NAME}"...`);

  // Limpia la hoja completa y escribe encabezado + datos desde cero.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_NAME
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS, ...rows] }
  });

  console.log(`✅ Migración completa: ${rows.length} transacciones escritas en Google Sheets.`);
}

main().catch(err => {
  console.error('❌ Error en la migración:', err.message);
  process.exit(1);
});
