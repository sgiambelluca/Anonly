/**
 * `useTypeChoice` — la elección de tipo de un contenedor del `EntityTypePicker`
 * (`typeChoice.ts` tiene las reglas): estado, evaluación del nombre nuevo y las
 * props que el selector necesita.
 */

import type { EntityTypeId } from "@anonly/anonymization-core";
import { useCallback, useMemo, useState } from "react";

import { useDetectionStore } from "../../store/detection.store.js";

import type { NewTypeDraft } from "./newTypeInline.js";
import {
  chooseType,
  editNewType,
  evaluateChoice,
  initialChoice,
  resolveChoice,
  type ChoiceResolution,
  type TypeChoiceState,
} from "./typeChoice.js";
import { userTypeDefinitions } from "./userTypes.js";
import { useKnownUserTypes } from "./useUserTypes.js";

export function useTypeChoice(initial: EntityTypeId) {
  const [state, setState] = useState<TypeChoiceState>(() => initialChoice(initial));
  const [fallback, setFallback] = useState<EntityTypeId>(initial);
  const userTypes = useKnownUserTypes();
  const country = useDetectionStore((store) => store.saved.country);
  const existing = useMemo(() => userTypeDefinitions(userTypes), [userTypes]);

  const evaluation = useMemo(
    () => evaluateChoice(state, existing, country),
    [state, existing, country],
  );

  const onChange = useCallback((type: EntityTypeId) => setState((s) => chooseType(s, type)), []);
  const onNewTypeChange = useCallback(
    (draft: NewTypeDraft | null) => setState((s) => editNewType(s, draft, fallback)),
    [fallback],
  );
  /** Vuelve a la elección de apertura (los contenedores lo llaman al abrirse). */
  const reset = useCallback((value: EntityTypeId) => {
    setFallback(value);
    setState(initialChoice(value));
  }, []);

  return {
    state,
    userTypes,
    /** Props del `EntityTypePicker`. */
    pickerProps: {
      value: state.value,
      onChange,
      userTypes,
      newType: state.newType,
      onNewTypeChange,
      newTypeError: evaluation?.error ?? null,
    },
    /** El error de nombre para la línea de pie del contenedor. */
    error: evaluation?.error ?? null,
    /** Con «Nuevo tipo» elegido, el botón principal dice «Crear y …» y exige un nombre válido. */
    creating: state.value === "new",
    canConfirm: state.value !== "new" || (evaluation?.canSubmit ?? false),
    /** Lo que confirmar significa; `null` si todavía no se puede. */
    resolve: (): ChoiceResolution | null => resolveChoice(state, existing, country),
    reset,
  };
}
