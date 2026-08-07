const express = require('express');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'casillas2025';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('\n❌  Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_KEY.\n');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TABLE = 'transactions';

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

function handleSupabaseError(res, error) {
  console.error('Supabase error:', error.message);
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
app.get('/api/transactions', async (req, res) => {
  const { tipo, categoria, search, desde, hasta } = req.query;

  let query = supabase.from(TABLE).select('*').order('fecha', { ascending: false });

  if (tipo) query = query.eq('tipo', tipo);
  if (categoria) query = query.eq('categoria', categoria);
  if (search) query = query.ilike('concepto', `%${search}%`);
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query;
  if (error) return handleSupabaseError(res, error);
  res.json(data);
});

// GET /api/summary — aggregated KPIs
app.get('/api/summary', async (req, res) => {
  const { data: txs, error } = await supabase.from(TABLE).select('tipo, fecha, monto, categoria');
  if (error) return handleSupabaseError(res, error);

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
});

// POST /api/transactions — add a new transaction
app.post('/api/transactions', requireAuth, async (req, res) => {
  const { tipo, fecha, concepto, monto, categoria } = req.body;

  if (!tipo || !fecha || !concepto || monto === undefined || !categoria) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ tipo, fecha, concepto: concepto.trim(), monto: parseFloat(monto), categoria })
    .select()
    .single();

  if (error) return handleSupabaseError(res, error);
  res.status(201).json(data);
});

// PUT /api/transactions/:id — edit a transaction
app.put('/api/transactions/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { tipo, fecha, concepto, monto, categoria } = req.body;

  if (!tipo || !fecha || !concepto || monto === undefined || !categoria) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({ tipo, fecha, concepto: concepto.trim(), monto: parseFloat(monto), categoria })
    .eq('id', id)
    .select()
    .single();

  if (error) return handleSupabaseError(res, error);
  if (!data) return res.status(404).json({ error: 'Transacción no encontrada.' });
  res.json(data);
});

// DELETE /api/transactions/:id — delete a transaction
app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);

  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select().single();

  if (error) return handleSupabaseError(res, error);
  if (!data) return res.status(404).json({ error: 'Transacción no encontrada.' });
  res.json({ ok: true });
});

// GET /api/export — export transactions to xlsx
app.get('/api/export', async (req, res) => {
  const { data: txs, error } = await supabase.from(TABLE).select('*').order('fecha', { ascending: true });
  if (error) return handleSupabaseError(res, error);

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
