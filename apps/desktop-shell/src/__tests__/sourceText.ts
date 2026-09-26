/**
 * Utilidades compartidas por los tests estáticos que leen el propio fuente
 * del shell (`bootstrap-order.test.ts`, `mac-updater-deferred-init.test.ts`):
 * sacar comentarios antes de buscar texto, y extraer el cuerpo de una función
 * o de un callback contando llaves en vez de adivinar dónde termina.
 *
 * No son un parser: no distinguen un `//` o un `{`/`}` dentro de un string
 * literal. Ninguno de los archivos que estos tests leen hoy tiene ese caso en
 * las zonas que se extraen, y un parser de verdad sería desproporcionado para
 * lo que estos gates verifican.
 */

/**
 * Saca comentarios de bloque y de línea. Sin esto, un comentario que
 * mencione el texto buscado (documentando justamente la regla que el test
 * verifica, como pasa en este mismo módulo) da un falso positivo.
 */
export function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * El texto entre la primera `{` que sigue a `desde` y su `}` de cierre,
 * contando profundidad de llaves — a diferencia de buscar la próxima línea
 * que empieza con `}`, esto no depende de la indentación ni de que el cuerpo
 * no tenga bloques anidados sin indentar.
 */
export function bodyAfter(source: string, desde: number): string {
  const braceStart = source.indexOf("{", desde);
  if (braceStart === -1) throw new Error(`no se encontró "{" después de la posición ${desde}`);

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre de la llave abierta en la posición ${braceStart}`);
}

/** El cuerpo `{ ... }` de la función declarada como `function <nombre>(`. */
export function functionBody(source: string, nombre: string): string {
  const marker = `function ${nombre}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`no se encontró "${marker}"`);
  return bodyAfter(source, start);
}

/**
 * El cuerpo del callback de la primera llamada `ipcMain.on("<canal>", ...)`
 * que aparece en `source` a partir de `fromIndex`, y el resto de `source` con
 * ese callback quitado (para poder afirmar que un texto NO aparece fuera de
 * él). `fromIndex` importa cuando el mismo canal se registra más de una vez
 * en el archivo (Windows y macOS son ramas distintas de `startUpdater`, y
 * cada una registra `updater:set-automatic-checks` por su cuenta).
 */
export function ipcHandlerBody(
  source: string,
  canal: string,
  fromIndex = 0,
): { readonly handlerBody: string; readonly withoutHandler: string } {
  const marker = `ipcMain.on("${canal}"`;
  const markerIndex = source.indexOf(marker, fromIndex);
  if (markerIndex === -1)
    throw new Error(`no se encontró ${marker} desde la posición ${fromIndex}`);

  const handlerBody = bodyAfter(source, markerIndex);
  const handlerEnd = source.indexOf(handlerBody, markerIndex) + handlerBody.length;
  const withoutHandler = source.slice(0, markerIndex) + source.slice(handlerEnd);
  return { handlerBody, withoutHandler };
}
