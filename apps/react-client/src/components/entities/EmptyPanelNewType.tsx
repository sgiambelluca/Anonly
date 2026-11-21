/**
 * `EmptyPanelNewType` — la banda «Nuevo tipo» del panel cuando todavía no hay
 * entidades ni tipos del documento (`Components.md` §13b.6, `UX_Guidelines.md`
 * §11b.15). Va arriba, en su ranura fija, y el estado vacío de siempre queda
 * debajo. Abre `UserTypeDialog` con `scope: "document"`.
 */

import { useState } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import { UserTypeDialog } from "../formats/UserTypeDialog.js";

import { applyCreateDocumentType } from "./documentTypeEdits.js";
import { NewTypeBand } from "./NewTypeBand.js";
import { useUserTypes } from "./useUserTypes.js";

export function EmptyPanelNewType() {
  const [open, setOpen] = useState(false);
  const userTypes = useUserTypes();
  const country = useDetectionStore((state) => state.saved.country);
  return (
    <>
      <NewTypeBand onClick={() => setOpen(true)} />
      <UserTypeDialog
        open={open}
        scope="document"
        mode="create"
        existing={userTypes}
        country={country}
        onSubmit={(definition) => {
          setOpen(false);
          applyCreateDocumentType(definition);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
