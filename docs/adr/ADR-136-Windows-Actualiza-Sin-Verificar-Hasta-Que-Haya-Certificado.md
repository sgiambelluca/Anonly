<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,architecture/08_Security_Model.md,roadmap/MVP.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-136 — Windows actualiza sin verificar firma, hasta que haya certificado

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, sobre el hallazgo del revisor al implementar el actualizador de Windows.
- **Relacionado con**: ADR-131 §2 (elección de `electron-updater`), ADR-131 §4 (**este ADR lo acota**), `08_Security_Model.md` §2.1
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

ADR-131 §4 decidió que **toda** actualización se verifica con clave propia y que la app **rechaza** lo que no valide. Está escrito sin acotar plataforma, y con un argumento que sigue siendo cierto:

> "HTTPS no sustituye esto: protege el transporte, no el origen. Si la cuenta de GitHub se ve comprometida, HTTPS entrega el release malicioso intacto."

En macOS eso se cumple: Sparkle valida con una clave Ed25519 cuya privada no vive en GitHub. En Windows **no se cumple**, y la implementación de ADR-131 §2 lo dejó así sin decirlo en ningún ADR.

`electron-updater` verifica la firma Authenticode del `.exe` que descarga. Verificar exige un certificado de firma de código, que cuesta dinero. La vía gratuita es SignPath Foundation, que pide que el proyecto sea open source con cierta trayectoria; está anotada como pendiente en `roadmap/MVP.md` §Hito 11.5 y todavía no llegó.

Sin certificado hay tres caminos, y ninguno es bueno:

1. **No publicar para Windows.** Es la plataforma donde el producto tiene más usuarios; la usa la primera usuaria real.
2. **Publicar sin actualizador.** Los parches de seguridad dejan de llegar a esa mitad de los usuarios, que es peor que el riesgo que se evita.
3. **Publicar con actualizador sin verificar.** Queda un hueco real, acotado y decible.

## Decisión

**Se toma el camino 3, y se dice.**

### 1. Qué queda protegiendo el canal en Windows

Solo HTTPS contra GitHub. Eso impide que alguien altere el instalador **en tránsito**; no cubre un release malicioso publicado desde una cuenta de GitHub comprometida. macOS no tiene este hueco.

El riesgo no es hipotético en su forma —es el escenario que ADR-131 §4 nombra explícitamente— pero sí es acotado: exige comprometer la cuenta de GitHub del proyecto, que es el mismo evento que también permitiría publicar un instalador malicioso directo, sin pasar por el actualizador.

### 2. Cómo se saltea la verificación, de verdad

**No se apaga con un flag.** Esto importa porque la primera implementación creyó que sí, y el código decía algo falso:

```ts
// Lo que NO funciona:
(autoUpdater as unknown as { verifyUpdateCodeSignature?: boolean })
  .verifyUpdateCodeSignature = false;
```

`verifyUpdateCodeSignature` no es un booleano: es un accessor cuyo valor es una **función** de verificación, y su setter descarta los valores falsy (`electron-updater@6.8.9`, `out/NsisUpdater.js`):

```js
set verifyUpdateCodeSignature(value) {
    if (value) { this._verifyUpdateCodeSignature = value; }
}
```

O sea que asignar `false` es un no-op comprobado: el verificador por defecto queda instalado igual. Lo que en realidad saltea la verificación es otra cosa — `verifySignature()` retorna `null` y no llega a llamar al verificador cuando **`publisherName` no está configurado**:

```js
publisherName = (await this.configOnDisk.value).publisherName;
if (publisherName == null) { return null; }
```

Y `apps/desktop-shell/electron-builder.yml` no declara `publisherName` porque no hay certificado del cual derivarlo.

**La condición se invierte sola**: el día que exista el certificado, `electron-builder` va a firmar y a escribir `publisherName`, y la verificación se enciende sin que nadie borre una línea.

### 3. La condición de salida es un test, no un comentario

Un comentario que dice "revertir cuando exista el certificado" no se ejecuta, y el anterior además describía un mecanismo inexistente. La condición vive en `apps/desktop-shell/src/__tests__/windows-updater.test.ts`:

- Afirma que `electron-builder.yml` **no** declara `publisherName` ni certificado. Cuando alguien agregue el certificado, ese test falla y obliga a pasar por acá: a revisar este ADR, no a descubrirlo leyendo `NsisUpdater.js`.
- Afirma que el código del shell **no** intenta asignar `verifyUpdateCodeSignature`, para que el no-op no vuelva por copiar y pegar de un issue.

### 4. Qué se le dice al usuario

El hueco se declara en los tres lugares donde alguien lo buscaría, y ya está escrito: `08_Security_Model.md` §2.1 (fila "Actualización maliciosa"), el README de la raíz (sección "Lo único que la app le pide a internet") y `apps/desktop-shell/README.md`. No se declara en la UI: el usuario de Windows no tiene ninguna decisión que tomar al respecto —no puede activar una verificación que no existe—, y un cartel sobre un riesgo que no puede mitigar es ruido, no divulgación.

## Consecuencias

**A favor**

- La decisión existe y es auditable. Antes vivía en un comentario de código que además citaba a ADR-131 §4 como si lo autorizara, cuando ADR-131 §4 dice lo contrario.
- La condición de salida es ejecutable: un test falla cuando el certificado llegue.
- Windows recibe parches de seguridad. Sin actualizador, cada defecto encontrado se queda en la máquina del usuario hasta que reinstale a mano.

**En contra**

- **El hueco es real y queda abierto.** Una cuenta de GitHub comprometida entrega una actualización maliciosa a los usuarios de Windows, y la app la aplica. Se cierra con SignPath, que sigue pendiente.
- Las dos plataformas tienen garantías distintas bajo la misma UI. El usuario de Windows ve el mismo aviso de actualización que el de macOS, con menos verificación atrás.
- ADR-131 §4 deja de ser universal. Sigue rigiendo en macOS y sigue siendo la meta en Windows; este ADR es la excepción con fecha de vencimiento, no su derogación.

**Lo que no toca**: el camino de macOS (Sparkle y su clave EdDSA siguen exactamente igual), el payload que viaja al renderer (ADR-131 §5), ni la decisión de distribuir por GitHub Releases (ADR-131 §1).
