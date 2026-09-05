---
---

Línea base de versión en `0.9.0`, fijada a mano.

Changesets no puede *llegar* a `0.9.0` desde `0.0.0` con un bump —minor daría
`0.1.0`—, así que el punto de partida se escribe una vez y desde acá lo maneja
la herramienta. Este changeset va vacío a propósito: no bumpea nada, deja
`changeset status` limpio, y documenta por qué las trece versiones saltaron sin
que hubiera un changeset que lo explicara.

El razonamiento del número está en `docs/roadmap/MVP.md` §"Versión objetivo".
