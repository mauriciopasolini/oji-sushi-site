#!/usr/bin/env node
// Cria (ou atualiza) um usuário do painel. Não existe cadastro público.
//
//   npm run criar-usuario -- --email fulano@x.com --nome "Fulano" --papel gestor
//   npm run criar-usuario -- --email fulano@x.com --nova-senha      (gera senha nova)
//   npm run criar-usuario -- --email fulano@x.com --inativar        (bloqueia o acesso)
//   npm run criar-usuario -- --email fulano@x.com --exigir-troca-senha
//
// Sempre que uma senha é gerada, o usuário é obrigado a trocá-la no próximo acesso.
//
// A senha gerada aparece UMA vez no terminal. Rode num terminal próprio (fora do
// chat do Claude Code) para que ela não fique registrada na conversa.

import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values: a } = parseArgs({
  options: {
    email: { type: "string" },
    nome: { type: "string" },
    papel: { type: "string" },
    "nova-senha": { type: "boolean", default: false },
    inativar: { type: "boolean", default: false },
    ativar: { type: "boolean", default: false },
    "exigir-troca-senha": { type: "boolean", default: false },
  },
});

const sair = (msg) => {
  console.error(msg);
  process.exit(1);
};

const email = a.email?.trim().toLowerCase();
if (!email) sair("Informe --email.");
if (a.papel && !["admin", "gestor"].includes(a.papel)) sair("--papel deve ser admin ou gestor.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) sair("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Senha legível: 4 blocos de 4, sem caracteres ambíguos (0/O, 1/l/I).
function gerarSenha() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("")).join("-");
}

async function acharUsuario(emailBusca) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === emailBusca);
    if (u || data.users.length < 200) return u ?? null;
  }
}

let senha = null;
let user = await acharUsuario(email);

if (!user) {
  if (!a.nome || !a.papel) sair("Usuário novo: informe também --nome e --papel.");
  senha = gerarSenha();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome: a.nome },
  });
  if (error) sair(`Erro ao criar usuário: ${error.message}`);
  user = data.user;
  console.log(`Usuário criado: ${email}`);
} else {
  console.log(`Usuário já existe: ${email}`);
  if (a["nova-senha"]) {
    senha = gerarSenha();
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password: senha });
    if (error) sair(`Erro ao trocar a senha: ${error.message}`);
  }
}

// Perfil do módulo
const { data: atual } = await supabase.from("perfis").select("*").eq("id", user.id).maybeSingle();
const perfil = {
  id: user.id,
  nome: a.nome ?? atual?.nome,
  papel: a.papel ?? atual?.papel,
  ativo: a.inativar ? false : a.ativar ? true : (atual?.ativo ?? true),
  deve_trocar_senha: senha !== null || a["exigir-troca-senha"] ? true : (atual?.deve_trocar_senha ?? false),
};
if (!perfil.nome || !perfil.papel) sair("Perfil incompleto: informe --nome e --papel.");

const { error: errPerfil } = await supabase.from("perfis").upsert(perfil);
if (errPerfil) sair(`Erro ao gravar o perfil: ${errPerfil.message}`);

console.log(`Perfil: ${perfil.nome} · ${perfil.papel} · ${perfil.ativo ? "ativo" : "INATIVO"}${perfil.deve_trocar_senha ? " · troca de senha obrigatória no próximo acesso" : ""}`);
if (senha) {
  console.log("\n  Senha (anote agora, não será mostrada de novo):");
  console.log(`  ${senha}\n`);
}
