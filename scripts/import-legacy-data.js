// Importa data/db.json (respaldo previo a Supabase) a la base SQLite.
// Uso: node scripts/import-legacy-data.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'gastos.db');
const JSON_PATH = path.join(__dirname, '..', 'data', 'db.json');

if (!fs.existsSync(JSON_PATH)) {
  console.error(`No se encontró ${JSON_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo      TEXT NOT NULL CHECK (tipo IN ('Ingreso', 'Egreso')),
    fecha     TEXT NOT NULL,
    concepto  TEXT NOT NULL,
    monto     REAL NOT NULL CHECK (monto >= 0),
    categoria TEXT NOT NULL
  );
`);

const existing = db.prepare('SELECT COUNT(*) as n FROM transactions').get();
if (existing.n > 0) {
  console.log(`⚠️  Ya hay ${existing.n} transacciones en la base. No se importó nada para evitar duplicados.`);
  console.log('   Si de verdad quieres reimportar, borra data/gastos.db primero.');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const txs = raw.transactions || [];

const insert = db.prepare(
  'INSERT INTO transactions (tipo, fecha, concepto, monto, categoria) VALUES (?, ?, ?, ?, ?)'
);

const insertMany = db.transaction((rows) => {
  for (const t of rows) {
    insert.run(t.tipo, t.fecha, t.concepto, t.monto, t.categoria);
  }
});

insertMany(txs);
console.log(`✅  Importadas ${txs.length} transacciones a ${DB_PATH}`);
