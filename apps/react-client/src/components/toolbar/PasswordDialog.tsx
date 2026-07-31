/**
 * `PasswordDialog` (`ui/Components.md` §2.7, ADR-036 §7).
 *
 * Se abre por `PDF_PASSWORD_REQUIRED`: suscripción **directa** de la UI al
 * canal `pdf` (ADR-034 §4), no vía `pipeline.store` (el bus-bridge de PR5
 * deliberadamente no expone este evento a ningún store — ver comentario en
 * `core-adapter/bus-bridge.ts` junto a `DOCUMENT_PARSED`). La suscripción en sí
 * vive en `core-adapter/bus-bridge.ts` (`subscribePasswordRequired`, agregado
 * en este PR): este componente solo la conecta a estado local dentro de un
 * `useEffect` (`ui/Components.md` §13 regla 6 — "sin useEffect para lógica de
 * negocio; solo para suscripciones del adapter").
 *
 * El cierre del diálogo se detecta observando `pipeline.store.stage`: mientras
 * la contraseña es incorrecta el pipeline se queda en `Extracting`
 * (`core/Orchestrator.md` §13 caso 3) y `PDF_PASSWORD_REQUIRED` se re-emite —
 * eso dispara "Contraseña incorrecta". En cuanto `stage` avanza a cualquier
 * otro valor (contraseña aceptada, o el documento falla por otra razón), el
 * diálogo se cierra solo. No se usa la resolución de la promesa de
 * `actions.retryWithPassword` para esto: como con contraseña incorrecta el
 * pipeline nunca llega a `Ready`/`Failed`/`Cancelled`, esa promesa podría no
 * resolver nunca mientras el usuario reintenta.
 *
 * Seguridad (`architecture/08_Security_Model.md` §7): el input nunca se
 * loguea ni persiste — vive solo en estado de React, `type="password"`, sin
 * autocompletado, y se descarta apenas se llama a `retryWithPassword`.
 */

import { PipelineStage } from "@anonly/anonymization-core";
import { useEffect, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { subscribePasswordRequired } from "../../core-adapter/bus-bridge.js";
import { getCoreAsync } from "../../core-adapter/index.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Button } from "../common/Button.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";

export function PasswordDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [wrongPassword, setWrongPassword] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const hasSubmittedRef = useRef(false);
  const stage = usePipelineStore((state) => state.stage);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // `getCoreAsync()`, no `initCore()` (PR17.3): este componente solo
    // necesita `core.bus`, nunca debe tener autoridad para arrancar
    // `createCore()` — eso es exclusivo de `App.tsx`, que le pasa el
    // `EngineConfigOverrides` derivado de `settings.store` (PR16.5). Como los
    // efectos de los hijos corren antes que los del padre en el mismo commit
    // de montaje, `PasswordDialog` (hijo de `App`) monta primero: si llamara
    // a `initCore()` acá, ganaría la carrera de inicialización y el override
    // de `App.tsx` se perdería en silencio.
    void getCoreAsync().then((core) => {
      if (cancelled) return;
      unsubscribe = subscribePasswordRequired(core.bus, () => {
        if (hasSubmittedRef.current) {
          // El evento se re-emitió para el mismo documentId: el reintento
          // anterior falló (core/Orchestrator.md §13 caso 3).
          setWrongPassword(true);
          setPassword("");
        } else {
          setOpen(true);
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // La contraseña fue aceptada (o el documento falló por otra razón): el
  // pipeline dejó de estar en Extracting mientras el diálogo esperaba.
  useEffect(() => {
    if (open && stage !== PipelineStage.Extracting) {
      setOpen(false);
      setPassword("");
      setWrongPassword(false);
      hasSubmittedRef.current = false;
    }
  }, [open, stage]);

  function handleSubmit(): void {
    if (password.length === 0) return;
    hasSubmittedRef.current = true;
    setWrongPassword(false);
    void actions.retryWithPassword(password);
    // El password nunca se persiste ni se loguea (08_Security_Model.md §7):
    // se descarta del estado local apenas se envía.
    setPassword("");
  }

  function handleOfferClose(): void {
    setConfirmCloseOpen(true);
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={handleOfferClose}
        title="El documento requiere contraseña"
        description="Ingresá la contraseña del PDF para continuar procesándolo."
        hideCloseButton
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="pdf-password" className="text-xs font-medium text-text-secondary">
            Contraseña
          </label>
          <input
            id="pdf-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {wrongPassword ? (
            <p role="alert" className="text-xs text-error">
              Contraseña incorrecta.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={handleOfferClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={password.length === 0}>
              Continuar
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmCloseOpen}
        title="Cerrar documento"
        message="¿Cerrar el documento protegido? Se perderá el progreso de importación."
        confirmLabel="Cerrar documento"
        cancelLabel="Volver"
        variant="danger"
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          setOpen(false);
          setPassword("");
          setWrongPassword(false);
          hasSubmittedRef.current = false;
          actions.closeDocument();
        }}
      />
    </>
  );
}
