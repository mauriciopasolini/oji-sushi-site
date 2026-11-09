#!/usr/bin/env node
// Aplica as migrações de supabase/migrations no banco de SUPABASE_DB_URL.
// Substitui a Supabase CLI (bloqueada pelo Smart App Control nesta máquina).
//
//   npm run db:migrate              aplica as pendentes
//   npm run db:migrate -- --status  só lista o estado
//
// Usa a mesma tabela de controle da CLI (supabase_migrations.schema_migrations),
// então os arquivos continuam compatíveis com `supabase db push` no futuro.
// Cada arquivo roda numa transação: ou entra inteiro, ou nada.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const DIR = path.resolve(import.meta.dirname, "..", "supabase", "migrations");
const somenteStatus = process.argv.includes("--status");

if (!process.env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL não definida (rode via npm run db:migrate, que carrega .env.local).");
  process.exit(1);
}

const sql = postgres(process.env.SUPABASE_DB_URL, {
  max: 1,
  onnotice: () => {},
  connection: { application_name: "oji-db-migrate" },
});

try {
  await sql`create schema if not exists supabase_migrations`;
  await sql`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    )`;

  const arquivos = (await readdir(DIR)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const aplicadas = new Map(
    (await sql`select version, name, statements from supabase_migrations.schema_migrations`).map((r) => [r.version, r]),
  );

  let pendentes = 0;
  for (const arquivo of arquivos) {
    const [, version, name] = arquivo.match(/^(\d{14})_(.+)\.sql$/);
    // Normaliza CRLF -> LF (checkout no Windows com autocrlf) para comparar e gravar sempre igual.
    const conteudo = (await readFile(path.join(DIR, arquivo), "utf8")).replace(/\r\n/g, "\n");
    const ja = aplicadas.get(version);

    if (ja) {
      const gravado = ja.statements?.[0]?.replace(/\r\n/g, "\n");
      const alterada = gravado !== undefined && gravado !== conteudo;
      console.log(`  ✓ ${arquivo}${alterada ? "   ⚠ arquivo alterado depois de aplicado — crie uma nova migração" : ""}`);
      continue;
    }

    pendentes++;
    if (somenteStatus) {
      console.log(`  · ${arquivo}   (pendente)`);
      continue;
    }

    process.stdout.write(`  → ${arquivo} … `);
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('oji-db-migrate'))`;
      await tx.unsafe(conteudo);
      await tx`insert into supabase_migrations.schema_migrations (version, name, statements)
               values (${version}, ${name}, ${[conteudo]})`;
    });
    console.log("ok");
  }

  if (pendentes === 0) console.log("Nada pendente. Banco em dia.");
  else if (somenteStatus) console.log(`${pendentes} migração(ões) pendente(s).`);
  else console.log(`${pendentes} migração(ões) aplicada(s).`);
} catch (e) {
  console.error("\nFALHOU:", e.message);
  if (e.position) console.error("posição no arquivo:", e.position);
  if (e.where) console.error("onde:", e.where);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
