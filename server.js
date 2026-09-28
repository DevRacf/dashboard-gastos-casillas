const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'casillas2025';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'gastos.db');

// Asegura que exista la carpeta de datos
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo      TEXT NOT NULL CHECK (tipo IN ('Ingreso', 'Egreso')),
    fecha     TEXT NOT NULL,
    concepto  TEXT NOT NULL,
    monto     REAL NOT NULL CHECK (monto >= 0),
    categoria TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS transactions_fecha_idx ON transactions (fecha);
  CREATE INDEX IF NOT EXISTS transactions_tipo_idx ON transactions (tipo);
`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.headers['x-admin-password'];
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta o sesión expirada.' });
  }
  next();
}

function handleDbError(res, error) {
  console.error('DB error:', error.message);
  return res.status(500).json({ error: 'Error de base de datos: ' + error.message });
}

// ─── API Endpoints ─────────────────────────────────────────────────────────────

// POST /api/login — verify admin password
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Contraseña incorrecta.' });
});

// GET /api/transactions — list all transactions with optional filters
app.get('/api/transactions', (req, res) => {
  const { tipo, categoria, search, desde, hasta } = req.query;

  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];

  if (tipo)      { sql += ' AND tipo = ?';           params.push(tipo); }
  if (categoria) { sql += ' AND categoria = ?';      params.push(categoria); }
  if (search)    { sql += ' AND concepto LIKE ?';    params.push(`%${search}%`); }
  if (desde)     { sql += ' AND fecha >= ?';         params.push(desde); }
  if (hasta)     { sql += ' AND fecha <= ?';         params.push(hasta); }

  sql += ' ORDER BY fecha DESC';

  try {
    const data = db.prepare(sql).all(...params);
    res.json(data);
  } catch (error) {
    handleDbError(res, error);
  }
});

// GET /api/summary — aggregated KPIs
app.get('/api/summary', (req, res) => {
  try {
    const txs = db.prepare('SELECT tipo, fecha, monto, categoria FROM transactions').all();

    const totalIngresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + t.monto, 0);
    const totalEgresos = txs.filter(t => t.tipo === 'Egreso').reduce((s, t) => s + t.monto, 0);
    const saldo = totalIngresos - totalEgresos;

    const categoriaEgresos = {};
    txs.filter(t => t.tipo === 'Egreso').forEach(t => {
      categoriaEgresos[t.categoria] = (categoriaEgresos[t.categoria] || 0) + t.monto;
    });

    const categoriaIngresos = {};
    txs.filter(t => t.tipo === 'Ingreso').forEach(t => {
      categoriaIngresos[t.categoria] = (categoriaIngresos[t.categoria] || 0) + t.monto;
    });

    const timeline = {};
    txs.forEach(t => {
      const month = t.fecha.substring(0, 7);
      if (!timeline[month]) timeline[month] = { ingresos: 0, egresos: 0 };
      if (t.tipo === 'Ingreso') timeline[month].ingresos += t.monto;
      else timeline[month].egresos += t.monto;
    });

    res.json({
      totalIngresos,
      totalEgresos,
      saldo,
      categoriaEgresos,
      categoriaIngresos,
      timeline,
      totalTransacciones: txs.length
    });
  } catch (error) {
    handleDbError(res, error);
  }
});

// POST /api/transactions — add a new transaction
app.post('/api/transactions', requireAuth, (req, res) => {
  const { tipo, fecha, concepto, monto, categoria } = req.body;

  if (!tipo || !fecha || !concepto || monto === undefined || !categoria) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  try {
    const info = db.prepare(
      'INSERT INTO transactions (tipo, fecha, concepto, monto, categoria) VALUES (?, ?, ?, ?, ?)'
    ).run(tipo, fecha, concepto.trim(), parseFloat(monto), categoria);

    const data = db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(data);
  } catch (error) {
    handleDbError(res, error);
  }
});

// PUT /api/transactions/:id — edit a transaction
app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { tipo, fecha, concepto, monto, categoria } = req.body;

  if (!tipo || !fecha || !concepto || monto === undefined || !categoria) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  try {
    const info = db.prepare(
      'UPDATE transactions SET tipo = ?, fecha = ?, concepto = ?, monto = ?, categoria = ? WHERE id = ?'
    ).run(tipo, fecha, concepto.trim(), parseFloat(monto), categoria, id);

    if (info.changes === 0) return res.status(404).json({ error: 'Transacción no encontrada.' });

    const data = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    res.json(data);
  } catch (error) {
    handleDbError(res, error);
  }
});

// DELETE /api/transactions/:id — delete a transaction
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const data = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!data) return res.status(404).json({ error: 'Transacción no encontrada.' });

    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error);
  }
});

// GET /api/export — export transactions to xlsx
app.get('/api/export', (req, res) => {
  try {
    const txs = db.prepare('SELECT * FROM transactions ORDER BY fecha ASC').all();

    const ingresos = txs.filter(t => t.tipo === 'Ingreso').map(t => ({
      Fecha: t.fecha,
      Concepto: t.concepto,
      Categoría: t.categoria,
      'Monto (MXN)': t.monto
    }));

    const egresos = txs.filter(t => t.tipo === 'Egreso').map(t => ({
      Fecha: t.fecha,
      Concepto: t.concepto,
      Categoría: t.categoria,
      'Monto (MXN)': t.monto
    }));

    const totalIngresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + t.monto, 0);
    const totalEgresos = txs.filter(t => t.tipo === 'Egreso').reduce((s, t) => s + t.monto, 0);

    const wb = XLSX.utils.book_new();

    const wsIngresos = XLSX.utils.json_to_sheet(ingresos);
    XLSX.utils.sheet_add_aoa(wsIngresos, [['', '', 'TOTAL INGRESOS', totalIngresos]], { origin: ingresos.length + 2 });
    XLSX.utils.book_append_sheet(wb, wsIngresos, 'Ingresos');

    const wsEgresos = XLSX.utils.json_to_sheet(egresos);
    XLSX.utils.sheet_add_aoa(wsEgresos, [['', '', 'TOTAL EGRESOS', totalEgresos]], { origin: egresos.length + 2 });
    XLSX.utils.book_append_sheet(wb, wsEgresos, 'Egresos');

    const resumen = [
      ['Familia Casillas — Control de Ingresos y Gastos 2025'],
      [],
      ['Concepto', 'Monto (MXN)'],
      ['Total Ingresos', totalIngresos],
      ['Total Egresos', totalEgresos],
      ['Saldo Neto', totalIngresos - totalEgresos],
      [],
      ['Exportado el', new Date().toLocaleString('es-MX')]
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumen);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="gastos_casillas_2025.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    handleDbError(res, error);
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  Dashboard Gastos Casillas corriendo en http://localhost:${PORT}\n`);
  console.log(`📁  Base de datos: ${DB_PATH}\n`);
});
