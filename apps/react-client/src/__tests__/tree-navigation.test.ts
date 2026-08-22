import { describe, expect, it } from "vitest";

import { resolveTreeKey, type TreeNode } from "../components/entities/treeNavigation.js";

/** Personas abierto con dos filas, Organizaciones cerrado (sus hijos no están). */
const nodes: ReadonlyArray<TreeNode> = [
  { kind: "type", id: "type:PERSON", expanded: true },
  { kind: "group", id: "group:a", parentId: "type:PERSON" },
  { kind: "group", id: "group:b", parentId: "type:PERSON" },
  { kind: "type", id: "type:ORGANIZATION", expanded: false },
];

describe("resolveTreeKey", () => {
  describe("recorrido vertical", () => {
    it("baja y sube por lo que se ve", () => {
      expect(resolveTreeKey(nodes, "type:PERSON", "ArrowDown")).toEqual({
        kind: "focus",
        nodeId: "group:a",
      });
      expect(resolveTreeKey(nodes, "group:b", "ArrowUp")).toEqual({
        kind: "focus",
        nodeId: "group:a",
      });
    });

    it("no da la vuelta en los extremos", () => {
      // Envolver haría perder la referencia de dónde está uno en una lista
      // que puede tener cientos de filas.
      expect(resolveTreeKey(nodes, "type:ORGANIZATION", "ArrowDown")).toEqual({
        kind: "focus",
        nodeId: "type:ORGANIZATION",
      });
      expect(resolveTreeKey(nodes, "type:PERSON", "ArrowUp")).toEqual({
        kind: "focus",
        nodeId: "type:PERSON",
      });
    });

    it("Home y End van a los extremos", () => {
      expect(resolveTreeKey(nodes, "group:b", "Home")).toEqual({
        kind: "focus",
        nodeId: "type:PERSON",
      });
      expect(resolveTreeKey(nodes, "group:a", "End")).toEqual({
        kind: "focus",
        nodeId: "type:ORGANIZATION",
      });
    });

    it("el primer tecleo, sin nodo activo, aterriza en el árbol en vez de no hacer nada", () => {
      expect(resolveTreeKey(nodes, null, "ArrowDown")).toEqual({
        kind: "focus",
        nodeId: "type:PERSON",
      });
      expect(resolveTreeKey(nodes, null, "End")).toEqual({
        kind: "focus",
        nodeId: "type:ORGANIZATION",
      });
      expect(resolveTreeKey(nodes, null, "Enter")).toBeNull();
    });
  });

  describe("flechas laterales: abrir, cerrar, entrar y salir", () => {
    it("derecha sobre un tipo cerrado lo abre", () => {
      expect(resolveTreeKey(nodes, "type:ORGANIZATION", "ArrowRight")).toEqual({
        kind: "expand",
        nodeId: "type:ORGANIZATION",
      });
    });

    it("derecha sobre un tipo ya abierto entra al primer hijo", () => {
      expect(resolveTreeKey(nodes, "type:PERSON", "ArrowRight")).toEqual({
        kind: "focus",
        nodeId: "group:a",
      });
    });

    it("izquierda sobre un tipo abierto lo cierra", () => {
      expect(resolveTreeKey(nodes, "type:PERSON", "ArrowLeft")).toEqual({
        kind: "collapse",
        nodeId: "type:PERSON",
      });
    });

    it("izquierda sobre una fila sube al tipo, aunque no sea el nodo anterior", () => {
      expect(resolveTreeKey(nodes, "group:b", "ArrowLeft")).toEqual({
        kind: "focus",
        nodeId: "type:PERSON",
      });
    });

    it("las laterales no hacen nada donde no prometen nada", () => {
      expect(resolveTreeKey(nodes, "group:a", "ArrowRight")).toBeNull();
      expect(resolveTreeKey(nodes, "type:ORGANIZATION", "ArrowLeft")).toBeNull();
    });
  });

  describe("acciones", () => {
    it("Space habilita o deshabilita, en los dos niveles", () => {
      expect(resolveTreeKey(nodes, "group:a", " ")).toEqual({
        kind: "toggleEnabled",
        nodeId: "group:a",
      });
      expect(resolveTreeKey(nodes, "type:PERSON", " ")).toEqual({
        kind: "toggleEnabled",
        nodeId: "type:PERSON",
      });
    });

    it("Enter abre el menú de una fila, y no se intercepta en una cabecera", () => {
      // Una cabecera de tipo no tiene menú contextual: interceptar la tecla
      // ahí la haría desaparecer sin dar nada a cambio.
      expect(resolveTreeKey(nodes, "group:a", "Enter")).toEqual({
        kind: "openMenu",
        nodeId: "group:a",
      });
      expect(resolveTreeKey(nodes, "type:PERSON", "Enter")).toBeNull();
    });

    it("una tecla cualquiera no significa nada acá", () => {
      expect(resolveTreeKey(nodes, "group:a", "x")).toBeNull();
    });
  });

  it("sin nodos no hay nada que navegar", () => {
    expect(resolveTreeKey([], null, "ArrowDown")).toBeNull();
  });
});
