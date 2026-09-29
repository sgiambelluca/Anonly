/**
 * ADR-162 §13 caso 23 / ADR-165 §2.1 / ADR-190 §3: predicado de "píxel
 * presente", reutilizado LITERAL por las tres reglas que lo necesitan
 * (franjas de margen visualmente blancas, franjas ya explicadas por la
 * pasada derecha, y `inkRatio` del kernel de orientación) — una copia
 * divergente mediría otra cosa y ningún test lo detectaría (handoff §1.2 de
 * ADR-165; ADR-190 §3 lo trae explícitamente: "el mismo predicado literal de
 * ADR-162"). Vive en su propio módulo porque `kernel.ts` (reconocimiento) y
 * `orientation-kernel.ts` (OSD) son los dos consumidores, y ninguno importa
 * del otro (P-1/P-2 aplican también adentro de un mismo paquete entre sus
 * dos kernels).
 */
export function isPixelPresent(
  r: number | undefined,
  g: number | undefined,
  b: number | undefined,
  alpha: number | undefined,
): boolean {
  return alpha !== 0 && (r !== 255 || g !== 255 || b !== 255);
}
