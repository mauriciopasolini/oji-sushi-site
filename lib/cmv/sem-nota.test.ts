import { describe, expect, it } from "vitest";
import { validarSemNota } from "./sem-nota";

const base = { tipoAnterior: null, observacao: "", numero: "", fotoTrocada: false } as const;

describe("compra sem nota (aguardando)", () => {
  it("criar sem nota exige observação", () => {
    expect(validarSemNota({ ...base, tipo: "sem_nota" })).toMatch(/observação/);
    expect(validarSemNota({ ...base, tipo: "sem_nota", observacao: "   " })).toMatch(/observação/);
    expect(validarSemNota({ ...base, tipo: "sem_nota", observacao: "Frumar entregou salmão; nota vem amanhã" })).toBeNull();
  });

  it("outros tipos não exigem observação", () => {
    expect(validarSemNota({ ...base, tipo: "nfe" })).toBeNull();
    expect(validarSemNota({ ...base, tipo: "cupom" })).toBeNull();
  });

  it("nota fiscal chegou: exige foto nova e número (NF-e/cupom)", () => {
    const edicao = { tipoAnterior: "sem_nota" as const, observacao: "x" };
    expect(validarSemNota({ ...edicao, tipo: "nfe", numero: "123", fotoTrocada: false })).toMatch(/foto/);
    expect(validarSemNota({ ...edicao, tipo: "nfe", numero: "", fotoTrocada: true })).toMatch(/número/);
    expect(validarSemNota({ ...edicao, tipo: "cupom", numero: " ", fotoTrocada: true })).toMatch(/número/);
    expect(validarSemNota({ ...edicao, tipo: "nfe", numero: "4521", fotoTrocada: true })).toBeNull();
    expect(validarSemNota({ ...edicao, tipo: "comanda", numero: "", fotoTrocada: true })).toBeNull();
  });

  it("editar continuando sem nota não exige foto nova", () => {
    expect(validarSemNota({ tipoAnterior: "sem_nota", tipo: "sem_nota", observacao: "ainda sem nota", numero: "", fotoTrocada: false })).toBeNull();
  });
});
