const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'casillas2025';

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

function readDB() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-admin-password'];
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta o sesión expirada.' });
  }
  next();
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
  const db = readDB();
  let txs = db.transactions;

  const { tipo, categoria, search, desde, hasta } = req.query;

  if (tipo) txs = txs.filter(t => t.tipo === tipo);
  if (categoria) txs = txs.filter(t => t.categoria === categoria);
  if (search) {
    const q = search.toLowerCase();
    txs = txs.filter(t => t.concepto.toLowerCase().includes(q));
  }
  if (desde) txs = txs.filter(t => t.fecha >= desde);
  if (hasta) txs = txs.filter(t => t.fecha <= hasta);

  res.json(txs);
});

// GET /api/summary — aggregated KPIs
app.get('/api/summary', (req, res) => {
  const db = readDB();
  const txs = db.transactions;

  const totalIngresos = txs.filter(t => t.tipo === 'Ingreso').reduce((s, t) => s + t.monto, 0);
  const totalEgresos = txs.filter(t => t.tipo === 'Egreso').reduce((s, t) => s + t.monto, 0);
  const saldo = totalIngresos - totalEgresos;

  // Category breakdown for egresos
  const categoriaEgresos = {};
  txs.filter(t => t.tipo === 'Egreso').forEach(t => {
    categoriaEgresos[t.categoria] = (categoriaEgresos[t.categoria] || 0) + t.monto;
  });

  const categoriaIngresos = {};
  txs.filter(t => t.tipo === 'Ingreso').forEach(t => {
    categoriaIngresos[t.categoria] = (categoriaIngresos[t.categoria] || 0) + t.monto;
  });

  // Timeline data grouped by month
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
});

// POST /api/transactions — add a new transaction
app.post('/api/transactions', requireAuth, (req, res) => {
  const db = readDB();
  const { tipo, fecha, concepto, monto, categoria } = req.body;

  if (!tipo || !fecha || !concepto || monto === undefined || !categoria) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  const newTx = {
    id: db.nextId,
    tipo,
    fecha,
    concepto: concepto.trim(),
    monto: parseFloat(monto),
    categoria
  };

  db.transactions.push(newTx);
  db.nextId += 1;
  writeDB(db);

  res.status(201).json(newTx);
});

// PUT /api/transactions/:id — edit a transaction
app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  const idx = db.transactions.findIndex(t => t.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Transacción no encontrada.' });

  const { tipo, fecha, concepto, monto, categoria } = req.body;
  db.transactions[idx] = { id, tipo, fecha, concepto: concepto.trim(), monto: parseFloat(monto), categoria };
  writeDB(db);

  res.json(db.transactions[idx]);
});

// DELETE /api/transactions/:id — delete a transaction
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  const idx = db.transactions.findIndex(t => t.id === id);

  if (idx === -1) return res.status(404).json({ error: 'Transacción no encontrada.' });

  db.transactions.splice(idx, 1);
  writeDB(db);

  res.json({ ok: true });
});

// GET /api/export — export transactions to xlsx
app.get('/api/export', (req, res) => {
  const db = readDB();
  const txs = db.transactions;

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

  // Sheet 1 — Ingresos
  const wsIngresos = XLSX.utils.json_to_sheet(ingresos);
  XLSX.utils.sheet_add_aoa(wsIngresos, [['', '', 'TOTAL INGRESOS', totalIngresos]], { origin: ingresos.length + 2 });
  XLSX.utils.book_append_sheet(wb, wsIngresos, 'Ingresos');

  // Sheet 2 — Egresos
  const wsEgresos = XLSX.utils.json_to_sheet(egresos);
  XLSX.utils.sheet_add_aoa(wsEgresos, [['', '', 'TOTAL EGRESOS', totalEgresos]], { origin: egresos.length + 2 });
  XLSX.utils.book_append_sheet(wb, wsEgresos, 'Egresos');

  // Sheet 3 — Resumen
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
});

// ─── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  Dashboard Gastos Casillas corriendo en http://localhost:${PORT}\n`);
});
