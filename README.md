# RalBot.io

Bot de Discord de código abierto para moderación básica: baneos permanentes o temporales, advertencias y notas privadas del equipo con una imagen opcional.

## Requisitos

- Node.js 20 o superior.
- Una aplicación y un bot creados en el [Discord Developer Portal](https://discord.com/developers/applications).
- El bot invitado al servidor con los scopes `bot` y `applications.commands`, y los permisos **Ban Members**, **Moderate Members**, **View Channels**, **Send Messages**, **Embed Links** y **Use External Emojis**.
- El intent privilegiado **Message Content Intent** habilitado en la sección **Bot** del Developer Portal.

## Configuración

1. Instala las dependencias:

   ```sh
   npm install
   ```

2. Configura las variables de entorno:

   - `DISCORD_TOKEN`: token del bot.
   - `DATABASE_PATH` (opcional): ruta del archivo SQLite. Por defecto es `data/ralbot.sqlite`.

3. Inicia el bot:

   ```sh
   npm start
   ```

Mantén el archivo SQLite y su directorio en almacenamiento persistente para conservar los datos y los baneos temporales al reiniciar.

## Comandos

- `!help`: muestra la lista de comandos.
- `/help`: muestra la lista de comandos slash.
- `!ban @usuario [tiempo] [razón]`: banea al usuario. `tiempo` es opcional; omítelo para un baneo permanente. Formatos temporales admitidos: `30s`, `15m`, `2h`, `7d` o `1w`, hasta un máximo de 365 días. El bot ejecuta el desbaneo al vencer el plazo, incluso después de reiniciarse.
- `!warn @usuario razón`: registra una advertencia, permite adjuntar una imagen y envía al usuario un DM con el motivo (y la imagen, si se adjunta). También está disponible como `/warn usuario razón imagen`.
- `!warnsee @usuario`: muestra hasta las 10 advertencias más recientes en un embed, numeradas y con sus motivos.
- Al registrar la sexta advertencia, el bot aplica un ban permanente y envía al usuario un DM con un botón para apelar. La apelación se manda por DM al dueño del servidor, que puede aceptar y desbanear o rechazarla.
- `!removewarns @usuario cantidad` o `/removewarns usuario cantidad`: quita entre 1 y 50 de las advertencias más recientes. Requiere permiso de moderación; no desbanea automáticamente.
- `!unban @usuario [razón]` o `/unban usuario`: quita manualmente un ban. Requiere permiso **Ban Members**.
- `!createnote @usuario nota`: guarda una nota para el equipo y envía al usuario un DM con la nota. Para adjuntar una imagen, inclúyela junto con el mensaje del comando.
- `!seenotes @usuario`: muestra las 10 notas más recientes, quién las guardó y sus imágenes adjuntas si tienen una.
- Los comandos `/ban`, `/warn`, `/warnsee`, `/removewarns`, `/seenotes`, `/createnote` y `/unban` también están disponibles como comandos slash.
- `!modifyprefix %` o `/modifyprefix prefijo`: cambia el prefijo de ese servidor. Solo se admite un símbolo (por ejemplo `!`, `%` o `?`) y se necesita el permiso **Manage Server**. El cambio se conserva en SQLite.

Los comandos con prefijo responden con embeds en el canal donde se escriben. Los comandos slash responden de forma privada y se registran por servidor; al iniciar, el bot elimina registros globales anteriores para evitar duplicados. Al invitarlo a otro servidor, también registra los comandos allí. Para que se muestren, incluye el scope `applications.commands` en la invitación. Los comandos de moderación requieren el permiso correspondiente; `help` está disponible para todos. Los baneos, advertencias y notas generan un aviso privado al usuario afectado; el embed de confirmación informa si el DM se pudo enviar. Si el usuario bloquea mensajes privados, la acción queda registrada igualmente y el moderador verá que no se pudo entregar el aviso. Las apelaciones guardan su estado en SQLite para que los botones sigan funcionando aunque se reinicie el bot. Quitar advertencias no quita automáticamente un ban; un moderador con permiso puede usar `unban` o el dueño aprobar una apelación. Las advertencias, notas y prefijos quedan separados por servidor. Las notas guardan el enlace del adjunto de Discord; como con cualquier enlace de CDN, su disponibilidad depende de Discord.

Los embeds resuelven los emojis animados desde los servidores que el bot puede ver. Al iniciar, el registro indica cuáles pudo encontrar; si falta alguno, revisa que el ID sea correcto y que el bot esté en el servidor donde vive ese emoji. Si el bot no tiene **Use External Emojis** en el canal, el embed usa un emoji normal en vez de mostrar código sin imagen.

## Pruebas

```sh
npm test
```
