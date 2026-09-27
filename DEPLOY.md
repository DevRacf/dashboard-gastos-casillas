# Desplegar en tu propio servidor (Docker)

Guía para correr el dashboard en tu servidor Linux (ej. `192.168.0.106`) con
Docker, sin depender de Supabase ni de un hosting externo.

## Requisitos

- Docker y el plugin `docker compose` instalados en el servidor.
  Verifica con:
  ```
  docker --version
  docker compose version
  ```
- La base de datos ya migrada a Google Sheets — sigue primero
  [`google-sheets/SETUP.md`](./google-sheets/SETUP.md) si no lo has hecho.

## 1. Llevar el código al servidor

Desde el propio servidor:

```
git clone <url-de-tu-repo> dashboard-gastos-casillas
cd dashboard-gastos-casillas
git checkout claude/migrate-supabase-google-sheets-b65zvi   # o main, una vez mergeado
```

(O copia la carpeta del proyecto por `scp`/`rsync` si no quieres usar git ahí.)

## 2. Configurar variables de entorno

Crea el archivo `.env` en la raíz del proyecto **en el servidor** (nunca lo
subas al repositorio):

```
cp .env.example .env
nano .env   # o el editor que prefieras
```

Rellena con tus valores reales:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=mi-cuenta@mi-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz
GOOGLE_SHEET_NAME=transactions
ADMIN_PASSWORD=elige-una-contraseña-fuerte
```

No incluyas `PORT` ni `HOST_PORT` aquí a menos que quieras cambiar el puerto
(ver siguiente sección) — el contenedor ya escucha en 3000 internamente.

## 3. Construir y arrancar

```
docker compose up -d --build
```

Esto deja el dashboard corriendo en **`http://192.168.0.106`** (puerto 80),
con `restart: unless-stopped`, así que vuelve a levantarse solo si el
servidor se reinicia (siempre que Docker arranque con el sistema, que es el
comportamiento por defecto).

Si el puerto 80 ya está en uso en tu servidor (por ejemplo por otro
servicio), cambia el puerto expuesto sin tocar el código, definiendo
`HOST_PORT` antes de levantar el contenedor:

```
HOST_PORT=8080 docker compose up -d --build
```

y accede entonces en `http://192.168.0.106:8080`.

## 4. Verificar

```
curl -I http://localhost        # o http://localhost:8080 si usaste HOST_PORT
docker compose logs -f          # ver logs en vivo
```

Desde otra máquina de tu red: abre `http://192.168.0.106` en el navegador.

## 5. Actualizar cuando cambie el código

```
git pull
docker compose up -d --build
```

## Comandos útiles

```
docker compose ps          # estado del contenedor
docker compose logs -f      # logs en vivo
docker compose down         # detener y quitar el contenedor
docker compose restart      # reiniciar sin reconstruir
```
