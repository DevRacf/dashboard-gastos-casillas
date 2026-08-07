// Migra las transacciones de data/db.json hacia la tabla `transactions` en Supabase.
// Uso (una sola vez, desde tu máquina o localmente en este repo):
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=xxxx node supabase/migrate.js
//
// Requiere que ya hayas corrido supabase/schema.sql en el SQL Editor de Supabase.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  const { transactions } = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

  const rows = transactions.map(({ tipo, fecha, concepto, monto, categoria }) => ({
    tipo, fecha, concepto, monto, categoria
  }));

  console.log(`Insertando ${rows.length} transacciones en Supabase...`);

  const { data, error } = await supabase.from('transactions').insert(rows).select();

  if (error) {
    console.error('❌ Error insertando:', error.message);
    process.exit(1);
  }

  console.log(`✅ Migración completa: ${data.length} transacciones insertadas.`);
}

main();
