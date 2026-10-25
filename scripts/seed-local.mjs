import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";

const db = createClient({ url: "file:local.db" });
const sql = await readFile(new URL("../db/migrations/001_init.sql", import.meta.url), "utf8");
await db.executeMultiple(sql);
await db.execute({
  sql: "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
  args: [
    "0ebc227d-8a49-4a4f-99d2-6702a0f1aabe",
    "edvaldomil@gmail.com",
    "$2b$10$jU0mBy/RxU23nGU14hVFDuon0EFCmWV60KB0bhbUSbbVrzztAQSVC",
  ],
});
await db.execute({
  sql: "INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end) VALUES (?, ?, ?, 'active', ?)",
  args: [
    "805c06d7-32ce-45af-90ca-1bae44e1b074",
    "0ebc227d-8a49-4a4f-99d2-6702a0f1aabe",
    "22222222-2222-4222-8222-222222222222",
    "2027-10-18T18:00:00.000Z",
  ],
});
const row = await db.execute("SELECT email FROM users");
console.log("ok", row.rows.map((r) => r.email).join(","));
db.close();
