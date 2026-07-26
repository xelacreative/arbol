# Nuestro Árbol Familiar

Experiencia colaborativa en tiempo real para videoconferencias (~50 participantes).
Cada persona entra desde su celular, responde 4 rondas guiadas por el facilitador,
y ve en vivo cómo sus respuestas y las de los demás se posan sobre el árbol.

## Estructura del proyecto

```
arbol-familiar/
├── package.json
├── server.js              ← servidor Express + Socket.io (estado del juego)
├── README.md
└── public/
    ├── index.html          ← todas las pantallas (landing, admin, árbol, final)
    ├── style.css
    ├── app.js               ← lógica del cliente
    └── assets/
        └── arbol-suenos-familiares.png
```

## Instalación local

Requisitos: Node.js 18 o superior.

```bash
npm install
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

## Cómo se usa

1. Abre `http://localhost:3000` (o la URL pública una vez desplegado) y compártela
   con los participantes.
2. Cada participante escribe su nombre y presiona **Entrar**.
3. El facilitador entra por el mismo enlace, hace clic en **"¿Eres facilitador?
   Acceso administrador"**, e ingresa la clave (por defecto `msol`).
4. Desde el panel del facilitador:
   - Toca **Hojas / Frutos / Agua / Raíces** para activar esa ronda. Los
     participantes solo pueden responder la ronda que esté encendida en ese
     momento — así se mantiene el orden entre 50 personas.
   - Vuelve a tocar la misma ronda (o usa **"Cerrar ronda actual"**) para
     cerrarla antes de abrir la siguiente.
   - **Reiniciar actividad** borra todas las respuestas y vuelve a empezar.
   - **Finalizar** cambia la pantalla de todos (participantes y facilitador)
     a fondo blanco con el mensaje de cierre.
5. El panel del facilitador muestra el mismo árbol en vivo — puedes compartir
   esa pantalla en Zoom/Teams para que todos vean el resultado colectivo, aunque
   cada participante también lo ve crecer en su propio celular.

## Notas técnicas

- **El estado vive en memoria del servidor.** Si el servidor se reinicia,
  la actividad vuelve a cero. Para una sesión de 10-15 minutos esto es
  intencional y evita depender de una base de datos.
- **Una respuesta por ronda por participante.** El servidor lo controla
  por `socket.id`, no se puede enviar dos veces la misma ronda.
- **La posición de cada tarjeta se calcula en el servidor** (en porcentaje,
  no en píxeles), por eso todos los participantes ven las tarjetas exactamente
  en el mismo lugar sin importar el tamaño de su pantalla.
- **Cambiar la clave de administrador** sin tocar el código: define la
  variable de entorno `ADMIN_PASSWORD` antes de iniciar el servidor:
  ```bash
  ADMIN_PASSWORD=otraClave npm start
  ```

## Desplegar en un hosting

Cualquier hosting que soporte Node.js + WebSockets sirve (Render, Railway,
Fly.io, un VPS propio, etc.). Pasos generales:

1. Sube esta carpeta completa (o conéctala a un repositorio Git).
2. Comando de build: `npm install`.
3. Comando de arranque: `npm start` (usa `server.js`, que lee el puerto de
   la variable de entorno `PORT` si el hosting la define automáticamente).
4. Asegúrate de que el plan/hosting permita conexiones **WebSocket**
   persistentes (Socket.io las necesita). La mayoría de los planes gratuitos
   de Render/Railway las soportan; verifica en la documentación del proveedor
   si usas otro.
5. Una vez desplegado, comparte la URL pública — esa es el enlace único que
   entra tanto participantes como el facilitador.

## Personalizar las preguntas

Las 4 rondas (etiqueta, pregunta y zona del árbol donde aparecen las
tarjetas) están centralizadas en `ROUND_INFO` dentro de `server.js`. Cambiar
el texto de una pregunta ahí es suficiente; el cliente lo recibe automáticamente.
