<!-- CONTEXT: scope=adr-aceptado | dependencias=adr/ADR-181-Email-Default-Con-Escaner-Lineal.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,core/Regex_Engine.md,core/Contracts.md,roadmap/mediciones/ocr/Emails_DPI_Nativo_2026-10-07.md,roadmap/mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md,roadmap/hardening/Confianza_1.0.x_Plan.md | audiencia=humanos+IA | fase=12 -->

# ADR-211 — El email tolera la arroba leída como `Q` en texto de OCR

- **Estado:** Aceptado por el mantenedor el 2026-10-07, con dos condiciones
  suyas: que la regla cubra también el espacio después del punto del nombre
  (punto 4), y que el avance se demuestre midiendo antes y después («Plan y
  validación»).
- **Fecha:** 2026-10-07.
- **Alcance:** `regex-engine`, patrón de email por defecto.
- **Relacionado con:** ADR-181 (el escáner lineal del email por defecto), que
  no cambia.

## Contexto

En un escaneo de baja resolución el OCR puede leer la `@` como una `Q`
mayúscula. El email queda escrito `nombre.apellidoQdominio.com`, el patrón no
encuentra ninguna `@`, y el dato se exporta sin anonimizar.

Medido sobre documentos sintéticos:

- Al forzar la lectura por debajo de 300 dpi se perdieron 11 emails; en 9 la
  `@` se leyó como `Q` (`DPI_Descendente_Fase1_Windows_2026-10-01.md` §2.1).
- A resolución nativa, sin forzar nada, se perdieron 2 de 25 a 150 dpi, los
  dos por la `Q`. A 200 y a 300 dpi, ninguno
  (`Emails_DPI_Nativo_2026-10-07.md`).
- En todo el texto leído de esa segunda medición no hay ninguna otra cadena
  con la forma «nombre, `Q`, dominio».

- Sobre textos con degradación de fotocopia a 150 dpi nativos se perdieron 4
  de 10. Los cuatro tienen la `Q`, y tres tienen además un espacio después
  del punto del nombre: `contacto. estudioQexample.org` (mismo informe,
  M-E2).

El mantenedor decidió el 2026-10-07 cubrir la `@` leída como `Q`, y, con el
dato de M-E2, también ese espacio.

## Decisión

1. **El patrón de email por defecto reconoce además la forma con `Q`**, como
   una segunda búsqueda que no altera la primera. Un email con `@` se detecta
   exactamente igual que hoy (ADR-181).
2. **Solo en texto que viene del OCR.** La forma con `Q` se acepta únicamente
   si todas las palabras que abarca tienen `source: "ocr"`. En un PDF con
   texto digital, `algoQalgo.com` es lo que el documento dice, y no se
   reinterpreta.
3. **La forma es estricta**: todo en minúsculas y dígitos, salvo esa `Q`.

   ```
   \b(?:[a-z0-9._%+-]*[a-z0-9]\. ){0,2}[a-z0-9._%+-]*[a-z0-9]Q[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b
   ```

   - Antes de la `Q`, el mismo conjunto de caracteres del nombre de un email,
     en minúsculas, terminando en letra o dígito.
   - Después, un dominio en minúsculas con su terminación de dos letras o
     más.
   - Empieza y termina en frontera de palabra, como el patrón actual.
   - El grupo inicial es el punto 4.

   La exigencia de minúsculas es el límite contra los falsos positivos: una
   marca escrita `ProQuest.com` no coincide, porque su nombre empieza en
   mayúscula. El costo es que un email escrito todo en mayúsculas y leído con
   `Q` no se recupera; ahí la `Q` no se distingue de una letra más.

   Comprobado el 2026-10-07 contra los textos leídos que guardaron las tres
   campañas: la expresión coincide con 9 de los 11 emails perdidos al forzar
   la resolución, con los 2 de M-E1 y con los 4 de M-E2, siempre con la
   dirección entera, y no coincide con ninguna cadena ajena. Es una
   comprobación sobre texto guardado; la medición de verdad es la de «Plan y
   validación».
4. **El espacio después del punto del nombre.** Cuando la forma con `Q`
   viene precedida por «tramo en minúsculas, punto, un espacio», ese tramo es
   parte del nombre y la ocurrencia lo incluye: `contacto. estudioQexample.org`
   se detecta entero. Hasta dos tramos. Vale solo para la forma con `Q`: un
   email leído con `@` no cambia.
5. **El valor se guarda como se leyó, y se agrupa como email.**
   `Occurrence.value` es el texto del documento tal como lo leyó el OCR, con
   la `Q` y con ese espacio. `normalizedValue` lleva la `@` restituida, sin el
   espacio y en minúsculas, así que la
   ocurrencia cae en el mismo grupo que las apariciones del mismo email leídas
   bien. Es el criterio que ya rige para cualquier otra lectura imperfecta del
   OCR: la lista muestra lo que se leyó.
6. **Un email con `@` gana.** Si la forma con `Q` se superpone con un email
   detectado por la búsqueda normal, se descarta.
7. **El costo sigue siendo lineal.** La segunda búsqueda se ancla en cada `Q`
   y recorre los tramos vecinos con índices monótonos, con el mismo criterio
   de ADR-181. No se reintenta desde cada carácter del prefijo.
8. **Los patrones propios no cambian.** Como en ADR-181, la tolerancia es del
   objeto del patrón por defecto; un patrón del usuario que se llame `email`
   sigue su camino de siempre.

No cambia ningún contrato: la ocurrencia sale con el mismo tipo, la misma
fuente (`regex`) y la misma confianza. Sin dependencias nuevas.

## Lo que no cubre

- **El punto del nombre leído como espacio** (`marina suarez@example.com`).
  Apareció solo al forzar la resolución, 2 de 11, y nunca a resolución
  nativa. El patrón detecta lo que quedó pegado a la `@` y deja afuera el
  resto del nombre. Tolerarlo obliga a adivinar dónde empieza el nombre, y el
  mantenedor lo dejó afuera.
- **El espacio sin punto**, o un espacio en otro lugar del nombre. La regla
  cubre solo «punto, espacio», que es lo que se midió.
- **Un email con `@` y con ese espacio** (`contacto. estudio@example.org`).
  No apareció en ninguna medición: en todos los casos medidos el espacio vino
  junto con la `Q`. Si aparece, se decide aparte.
- **Otras confusiones de la `@`** que no se midieron. Si aparecen, se miden y
  se deciden aparte.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Aceptar la forma con `Q` en cualquier texto | En un PDF digital no hay lectura que corregir: sería reinterpretar lo que el documento dice |
| Aceptar mayúsculas en el nombre | Hace coincidir marcas y nombres propios con una `Q` en el medio seguidos de un dominio |
| Limitar a una lista de terminaciones (`.com`, `.org`, `.ar`…) | Deja afuera dominios válidos y no evita el falso positivo que importa, que también termina en `.com` |
| Corregir el texto del OCR antes de detectar | Cambia `Page.text` para todos los motores y para la búsqueda del usuario, por un caso de un solo tipo |
| Subir la resolución de lectura por encima de la nativa | No agrega información que el escaneo no tiene; cuesta memoria y tiempo (ADR-163) |

## Consecuencias

- Un email leído con `Q` en un escaneo deja de escaparse.
- En la lista, ese email puede aparecer escrito con `Q` si es su única
  aparición. Se anonimiza igual.
- Riesgo de falso positivo: una cadena en minúsculas con una `Q` mayúscula en
  el medio y terminación de dominio, en un documento escaneado. Se
  anonimizaría de más; el usuario la ve en la lista y la puede deshabilitar.
  En la línea de base no hay ninguna.
- Riesgo de tapar una palabra de más: una oración que termina en una palabra
  en minúsculas, justo antes de un email leído con `Q` («…por correo.
  juanQgmail.com»). Esa palabra quedaría dentro de la ocurrencia.
- Cambia la detección: por `Roadmap_1.x.md` §1 es un parche, y las notas de
  la versión dicen que el mismo documento puede dar un resultado distinto.

## Plan y validación

Primero el spec: `Regex_Engine.md` (nota de versión, caso límite nuevo, tests
de §14 con sus nombres, ítem de §15 y la tabla de patrones por defecto).
Después el código, en `regex-engine` solo.

Pruebas:

- la forma con `Q` se detecta en palabras de OCR y no en palabras de PDF;
- minúsculas estrictas: `ProQuest.com` y un nombre con mayúsculas no
  coinciden;
- `normalizedValue` con la `@` restituida, y agrupación con el mismo email
  leído bien;
- un email con `@` da exactamente la misma salida que antes (el diferencial
  de ADR-181 sigue en verde);
- costo lineal sobre texto adverso con muchas `Q`, en el arnés de peores
  casos;
- el espacio después del punto: uno y dos tramos se incluyen, un tercero no;
  un email con `@` precedido por «palabra. » no cambia;
- **medición antes y después, condición del mantenedor**: los tres arneses
  (DPI descendente, emails nativos limpios y emails nativos degradados) se
  vuelven a correr con el cambio. Se espera: de los 11 perdidos al forzar la
  resolución, 9 recuperados; los 2 de M-E1 y los 4 de M-E2, recuperados;
  ningún email agregado que no esté en la verdad; ninguna otra entidad
  perdida. Si un número no se cumple, el cambio no se da por bueno y vuelve
  al mantenedor.
