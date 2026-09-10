# Configurar Google Sheets como base de datos

Este proyecto guarda las transacciones en una hoja de Google Sheets en vez de
una base de datos tradicional, para evitar que un proveedor con capa gratuita
(como Supabase) suspenda el proyecto por inactividad.

## 1. Crear la hoja de cálculo

1. Crea un Google Sheet nuevo (o reutiliza uno existente).
2. Renombra la primera pestaña a `transactions` (o define el nombre que
   prefieras y expórtalo luego como `GOOGLE_SHEET_NAME`).
3. En la fila 1 agrega el encabezado (el script de migración lo hace por ti,
   pero puedes crearlo a mano si prefieres empezar vacío):

   ```
   id | tipo | fecha | concepto | monto | categoria
   ```

4. Copia el ID del spreadsheet desde la URL:
   `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`

## 2. Crear una cuenta de servicio de Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/) y crea (o
   reutiliza) un proyecto.
2. Habilita la **Google Sheets API** para ese proyecto.
3. Crea una **cuenta de servicio** (IAM & Admin → Service Accounts).
4. Genera una clave para esa cuenta de servicio en formato JSON y descárgala.
5. Del JSON descargado necesitarás dos valores:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`

## 3. Compartir la hoja con la cuenta de servicio

En el Google Sheet, haz clic en **Compartir** y agrega el `client_email` de
la cuenta de servicio como **Editor**. Sin este paso la API responderá con
error de permisos.

## 4. Variables de entorno

Configura en tu `.env` (o en las variables de entorno de tu proveedor de
hosting):

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=mi-cuenta@mi-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GOOGLE_SHEET_NAME=transactions
```

`GOOGLE_PRIVATE_KEY` debe conservar los `\n` literales tal como vienen en el
JSON descargado; el código los convierte a saltos de línea reales al
arrancar. La mayoría de proveedores de hosting (Render, Railway, Vercel,
etc.) permiten pegar el valor con `\n` literales sin problema en una
variable de entorno de una sola línea.

## 5. Migrar los datos existentes

Con las variables anteriores ya definidas en tu entorno, ejecuta:

```
node google-sheets/migrate.js
```

Por defecto toma los datos de `data/db.json` (el seed original del
proyecto). Si tu base de Supabase todavía está accesible y quieres capturar
transacciones agregadas desde la app después de ese seed, instala
temporalmente el cliente de Supabase y agrega sus credenciales:

```
npm install @supabase/supabase-js --no-save
SUPABASE_URL=https://tu-proyecto.supabase.co SUPABASE_SERVICE_KEY=tu-service-role-key \
  GOOGLE_SERVICE_ACCOUNT_EMAIL=... GOOGLE_PRIVATE_KEY=... GOOGLE_SHEET_ID=... \
  node google-sheets/migrate.js
```

El script prioriza Supabase cuando esas variables están presentes y sólo cae
de vuelta a `data/db.json` si la lectura falla.

## 6. Límites a tener en cuenta

La API de Google Sheets tiene una cuota gratuita de 60 solicitudes de
lectura/escritura por minuto por usuario (300/min por proyecto), muy por
encima del tráfico esperado para un dashboard familiar. A diferencia de
Supabase, Google Sheets no se "suspende" por inactividad.
