/* ═══════════════════════════════════════════════════════════════════════════
   app.js — Dashboard Gastos Familia Casillas 2025
   ═══════════════════════════════════════════════════════════════════════════ */

const API = '/api';

let allTransactions = [];
let summary = {};
let chartIngresoDonut, chartEgresoDonut, chartTimeline;
let deleteTargetId = null;

// Google Material color palette
const CATEGORY_COLORS = {
  'Venta de Vehículos':                 '#4285F4',
  'Venta de Muebles / Electrodomésticos':'#1A73E8',
  'Venta de Varios / Artículos':         '#669DF6',
  'Otros Ingresos':                      '#8AB4F8',
  'Impuestos y Predial':                 '#EA4335',
  'Agua (SIAPA / SIBAPAS)':             '#1E8E3E',
  'Trámites Legales y Honorarios':       '#D93025',
  'Viáticos y Traslados':               '#FBBC04',
  'Mantenimiento y Servicios':           '#F9AB00',
  'Otros Gastos':                        '#9AA0A6'
};

// ─── Format currency ─────────────────────────────────────────────────────────

function fmt(amount) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Load & Render Summary ───────────────────────────────────────────────────

async function loadSummary() {
  summary = await apiFetch(`${API}/summary`);

  document.getElementById('val-ingresos').textContent = fmt(summary.totalIngresos);
  document.getElementById('val-egresos').textContent  = fmt(summary.totalEgresos);
  document.getElementById('val-saldo').textContent    = fmt(summary.saldo);
  document.getElementById('val-count').textContent    = summary.totalTransacciones;

  // Color saldo
  const saldoCard = document.getElementById('kpi-saldo');
  saldoCard.classList.toggle('kpi-saldo-neg', summary.saldo < 0);

  renderCharts();
}

// ─── Native SVG Charts (Zero Dependencies, 100% Browser Compatible) ─────────

function buildSvgDonut(containerId, dataObj) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!dataObj || Object.keys(dataObj).length === 0) {
    container.innerHTML = `<div class="empty-cell">Sin datos disponibles</div>`;
    return;
  }

  const entries = Object.entries(dataObj).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, val]) => sum + val, 0);
  if (total <= 0) {
    container.innerHTML = `<div class="empty-cell">Sin datos disponibles</div>`;
    return;
  }

  const R = 70;
  const C = 2 * Math.PI * R; // ~439.82
  let currentOffset = 0;

  const circleSegments = entries.map(([cat, val]) => {
    const pct = val / total;
    const dasharray = `${(pct * C).toFixed(2)} ${((1 - pct) * C).toFixed(2)}`;
    const offset = (-currentOffset * C).toFixed(2);
    currentOffset += pct;
    const color = CATEGORY_COLORS[cat] || '#9AA0A6';
    const pctText = (pct * 100).toFixed(1);

    return `<circle class="svg-donut-segment" cx="100" cy="100" r="${R}" 
              stroke="${color}" stroke-dasharray="${dasharray}" stroke-dashoffset="${offset}">
              <title>${cat}: ${fmt(val)} (${pctText}%)</title>
            </circle>`;
  }).join('');

  const legendItems = entries.map(([cat, val]) => {
    const color = CATEGORY_COLORS[cat] || '#9AA0A6';
    const pctText = ((val / total) * 100).toFixed(1);
    return `<div class="legend-item" title="${cat}: ${fmt(val)}">
              <span class="legend-dot" style="background:${color}"></span>
              <span>${escHtml(cat)} (${pctText}%)</span>
            </div>`;
  }).join('');

  container.innerHTML = `
    <div class="svg-donut-container">
      <svg class="svg-donut-chart" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="${R}" stroke="#f1f3f4" stroke-width="28" fill="none" />
        ${circleSegments}
      </svg>
      <div class="svg-donut-legend">
        ${legendItems}
      </div>
    </div>
  `;
}

function buildSvgBarChart(containerId, timelineObj) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!timelineObj || Object.keys(timelineObj).length === 0) {
    container.innerHTML = `<div class="empty-cell">Sin datos disponibles</div>`;
    return;
  }

  const months = Object.keys(timelineObj).sort();
  let maxVal = 0;
  months.forEach(m => {
    maxVal = Math.max(maxVal, timelineObj[m].ingresos || 0, timelineObj[m].egresos || 0);
  });
  if (maxVal === 0) maxVal = 10000;
  maxVal = Math.ceil(maxVal / 10000) * 10000;

  const svgWidth = 600;
  const svgHeight = 220;
  const paddingLeft = 45;
  const paddingBottom = 30;
  const paddingTop = 20;
  const paddingRight = 15;

  const chartAreaWidth = svgWidth - paddingLeft - paddingRight;
  const chartAreaHeight = svgHeight - paddingTop - paddingBottom;

  // Grid lines (3 levels)
  const gridLines = [0, maxVal / 2, maxVal].map(val => {
    const y = paddingTop + chartAreaHeight - (val / maxVal) * chartAreaHeight;
    const label = val >= 1000 ? `$${(val / 1000).toFixed(0)}k` : `$${val}`;
    return `
      <line class="chart-grid-line" x1="${paddingLeft}" y1="${y}" x2="${svgWidth - paddingRight}" y2="${y}" />
      <text class="chart-axis-text" x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end">${label}</text>
    `;
  }).join('');

  // X Axis Grouped Bars
  const groupWidth = chartAreaWidth / months.length;
  const barWidth = Math.min(Math.max((groupWidth - 12) / 2, 6), 18);

  const monthBars = months.map((m, idx) => {
    const ing = timelineObj[m].ingresos || 0;
    const egr = timelineObj[m].egresos || 0;

    const ingH = (ing / maxVal) * chartAreaHeight;
    const egrH = (egr / maxVal) * chartAreaHeight;

    const groupX = paddingLeft + idx * groupWidth + groupWidth / 2;
    const ingX = groupX - barWidth - 2;
    const egrX = groupX + 2;

    const ingY = paddingTop + chartAreaHeight - ingH;
    const egrY = paddingTop + chartAreaHeight - egrH;

    const [y, mo] = m.split('-');
    const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const monthLabel = `${names[parseInt(mo)-1]}`;

    return `
      <rect class="bar-ingreso" x="${ingX}" y="${ingY}" width="${barWidth}" height="${ingH}">
        <title>Ingresos (${monthLabel} ${y}): ${fmt(ing)}</title>
      </rect>
      <rect class="bar-egreso" x="${egrX}" y="${egrY}" width="${barWidth}" height="${egrH}">
        <title>Egresos (${monthLabel} ${y}): ${fmt(egr)}</title>
      </rect>
      <text class="chart-axis-text" x="${groupX}" y="${svgHeight - 10}" text-anchor="middle">${monthLabel}</text>
    `;
  }).join('');

  container.innerHTML = `
    <div class="svg-bar-container">
      <svg class="svg-bar-chart" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none">
        ${gridLines}
        <line class="chart-axis-line" x1="${paddingLeft}" y1="${paddingTop + chartAreaHeight}" x2="${svgWidth - paddingRight}" y2="${paddingTop + chartAreaHeight}" />
        ${monthBars}
      </svg>
    </div>
  `;
}

function renderCharts() {
  try {
    buildSvgDonut('wrapIngresosDonut', summary.categoriaIngresos);
    buildSvgDonut('wrapEgresosDonut', summary.categoriaEgresos);
    buildSvgBarChart('wrapTimeline', summary.timeline);
  } catch (err) {
    console.error('Error rendering SVG charts:', err);
  }
}

// ─── Transactions table ───────────────────────────────────────────────────────

async function loadTransactions() {
  const params = new URLSearchParams();
  const search    = document.getElementById('filter-search').value.trim();
  const tipo      = document.getElementById('filter-tipo').value;
  const categoria = document.getElementById('filter-categoria').value;
  const desde     = document.getElementById('filter-desde').value;
  const hasta     = document.getElementById('filter-hasta').value;

  if (search)    params.set('search', search);
  if (tipo)      params.set('tipo', tipo);
  if (categoria) params.set('categoria', categoria);
  if (desde)     params.set('desde', desde);
  if (hasta)     params.set('hasta', hasta);

  allTransactions = await apiFetch(`${API}/transactions?${params}`);
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('transactions-tbody');
  const info  = document.getElementById('table-footer-info');

  if (allTransactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No se encontraron transacciones con los filtros actuales.</td></tr>`;
    info.textContent = '';
    return;
  }

  const totalShown = allTransactions.reduce((s, t) => s + (t.tipo === 'Ingreso' ? t.monto : -t.monto), 0);

  tbody.innerHTML = allTransactions
    .slice()
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(t => `
      <tr data-id="${t.id}">
        <td>
          <span class="badge ${t.tipo === 'Ingreso' ? 'badge-ingreso' : 'badge-egreso'}">
            ${t.tipo === 'Ingreso' ? '▲' : '▼'} ${t.tipo}
          </span>
        </td>
        <td>${fmtDate(t.fecha)}</td>
        <td title="${escHtml(t.concepto)}">${escHtml(t.concepto)}</td>
        <td><span class="category-tag" title="${escHtml(t.categoria)}">${escHtml(t.categoria)}</span></td>
        <td class="align-right ${t.tipo === 'Ingreso' ? 'amount-ingreso' : 'amount-egreso'}">${fmt(t.monto)}</td>
        <td class="align-center">
          <div class="table-actions">
            <button class="btn-icon" onclick="openEdit(${t.id})" title="Editar transacción" aria-label="Editar ${escHtml(t.concepto)}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon" onclick="openDelete(${t.id})" title="Eliminar transacción" aria-label="Eliminar ${escHtml(t.concepto)}" style="color:#f87171">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

  info.textContent = `${allTransactions.length} transacción${allTransactions.length !== 1 ? 'es' : ''} · Balance filtrado: ${fmt(totalShown)}`;
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Populate category filter ─────────────────────────────────────────────────

async function populateCategoryFilter() {
  const allTx = await apiFetch(`${API}/transactions`);
  const cats = [...new Set(allTx.map(t => t.categoria))].sort();
  const sel = document.getElementById('filter-categoria');
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('form-fecha').valueAsDate = new Date();
  document.getElementById('form-tipo').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('transaction-form').reset();
  document.getElementById('form-id').value = '';
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('modal-title').textContent = 'Nueva Transacción';
  document.getElementById('form-submit').textContent = 'Guardar';
}

function openEdit(id) {
  const tx = allTransactions.find(t => t.id === id);
  if (!tx) return;

  document.getElementById('form-id').value       = tx.id;
  document.getElementById('form-tipo').value     = tx.tipo;
  document.getElementById('form-fecha').value    = tx.fecha;
  document.getElementById('form-concepto').value = tx.concepto;
  document.getElementById('form-categoria').value= tx.categoria;
  document.getElementById('form-monto').value    = tx.monto;
  document.getElementById('modal-title').textContent = 'Editar Transacción';
  document.getElementById('form-submit').textContent = 'Actualizar';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('form-tipo').focus();
}

function openDelete(id) {
  deleteTargetId = id;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('confirm-overlay').classList.add('hidden');
}

// ─── Form submit ──────────────────────────────────────────────────────────────

document.getElementById('transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  errEl.classList.add('hidden');

  const id        = document.getElementById('form-id').value;
  const tipo      = document.getElementById('form-tipo').value;
  const fecha     = document.getElementById('form-fecha').value;
  const concepto  = document.getElementById('form-concepto').value.trim();
  const categoria = document.getElementById('form-categoria').value;
  const monto     = parseFloat(document.getElementById('form-monto').value);

  if (!tipo || !fecha || !concepto || !categoria || isNaN(monto) || monto <= 0) {
    errEl.textContent = 'Por favor completa todos los campos correctamente.';
    errEl.classList.remove('hidden');
    return;
  }

  const body = { tipo, fecha, concepto, categoria, monto };

  try {
    if (id) {
      await apiFetch(`${API}/transactions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Transacción actualizada correctamente ✓');
    } else {
      await apiFetch(`${API}/transactions`, { method: 'POST', body: JSON.stringify(body) });
      showToast('Transacción agregada correctamente ✓');
    }
    closeModal();
    await refreshAll();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

// ─── Delete confirm ───────────────────────────────────────────────────────────

document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (!deleteTargetId) return;
  try {
    await apiFetch(`${API}/transactions/${deleteTargetId}`, { method: 'DELETE' });
    showToast('Transacción eliminada.');
    closeDeleteModal();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ─── Export ───────────────────────────────────────────────────────────────────

document.getElementById('btn-export').addEventListener('click', async () => {
  const btn = document.getElementById('btn-export');
  btn.disabled = true;
  btn.textContent = 'Exportando…';
  try {
    const res = await fetch(`${API}/export`);
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos_casillas_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Archivo Excel descargado ✓');
  } catch (err) {
    showToast('Error al exportar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar XLSX`;
  }
});

// ─── Filters ──────────────────────────────────────────────────────────────────

let filterDebounce;
function onFilterChange() {
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(loadTransactions, 280);
}

document.getElementById('filter-search').addEventListener('input', onFilterChange);
document.getElementById('filter-tipo').addEventListener('change', loadTransactions);
document.getElementById('filter-categoria').addEventListener('change', loadTransactions);
document.getElementById('filter-desde').addEventListener('change', loadTransactions);
document.getElementById('filter-hasta').addEventListener('change', loadTransactions);

document.getElementById('btn-clear-filters').addEventListener('click', () => {
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-tipo').value = '';
  document.getElementById('filter-categoria').value = '';
  document.getElementById('filter-desde').value = '';
  document.getElementById('filter-hasta').value = '';
  loadTransactions();
});

// ─── Button wiring ────────────────────────────────────────────────────────────

document.getElementById('btn-add').addEventListener('click', () => {
  document.getElementById('form-id').value = '';
  document.getElementById('modal-title').textContent = 'Nueva Transacción';
  document.getElementById('form-submit').textContent = 'Guardar';
  openModal();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('confirm-cancel').addEventListener('click', closeDeleteModal);

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.getElementById('confirm-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('confirm-overlay')) closeDeleteModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDeleteModal(); }
});

// ─── Refresh all ──────────────────────────────────────────────────────────────

async function refreshAll() {
  await Promise.all([loadSummary(), loadTransactions()]);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await populateCategoryFilter();
    await refreshAll();
  } catch (err) {
    document.getElementById('transactions-tbody').innerHTML =
      `<tr><td colspan="6" class="empty-cell">⚠️ No se pudo conectar con el servidor. Asegúrate de que el servidor está corriendo en localhost:3000</td></tr>`;
    console.error(err);
  }
})();
