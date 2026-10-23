import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INITIAL_EMPTY_TASKS = [
  {
    id: "g-1",
    wbs: "1",
    name: "",
    type: "group",
    parentId: null,
    category: "",
    responsible: "",
    supplier: "",
    startDate: "2026-10-27",
    endDate: "2026-10-27",
    dependencyType: "parallel",
    predecessorId: null,
    expanded: true,
  },
  {
    id: "t-1",
    wbs: "1.1",
    name: "",
    type: "task",
    parentId: "g-1",
    category: "",
    responsible: "",
    supplier: "",
    startDate: "2026-10-27",
    endDate: "2026-10-28",
    dependencyType: "parallel",
    predecessorId: null,
  },
];

const DEFAULT_DB_B64 =
  "cG9zdGdyZXNxbDovL25lb25kYl9vd25lcjpucGdfMHFSZ2ZNRkZ3eFhpQGVwLWRhd24tZHJlYW0tYWNnMzB0emgtcG9vbGVyLnNhLWVhc3QtMS5hd3MubmVvbi50ZWNoL25lb25kYj9zc2xtb2RlPXJlcXVpcmU=";

function getSql() {
  const fallbackUrl = Buffer.from(
    "cG9zdGdyZXNxbDovL25lb25kYl9vd25lcjpucGdfMHFSMWZNRkZ3eFhpQGVwLWRhd24tZHJlYW0tYWNnMzB0emgtcG9vbGVyLnNhLWVhc3QtMS5hd3MubmVvbi50ZWNoL25lb25kYj9zc2xtb2RlPXJlcXVpcmU=",
    "base64"
  ).toString("utf-8");
  const dbUrl =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || fallbackUrl;
  return neon(dbUrl);
}

async function ensureTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS obra_catuai_schedule (
      id VARCHAR(64) PRIMARY KEY,
      tasks JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function GET() {
  try {
    const sql = getSql();
    await ensureTable(sql);

    const rows = await sql`
      SELECT id, tasks, updated_at
      FROM obra_catuai_schedule
      WHERE id = 'main'
      LIMIT 1
    `;

    if (rows.length === 0) {
      const inserted = await sql`
        INSERT INTO obra_catuai_schedule (id, tasks, updated_at)
        VALUES ('main', ${JSON.stringify(INITIAL_EMPTY_TASKS)}::jsonb, NOW())
        RETURNING id, tasks, updated_at
      `;
      return NextResponse.json({
        ok: true,
        tasks: inserted[0].tasks,
        updatedAt: inserted[0].updated_at,
      });
    }

    return NextResponse.json({
      ok: true,
      tasks: rows[0].tasks,
      updatedAt: rows[0].updated_at,
    });
  } catch (error: any) {
    console.error("GET /api/schedule error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Erro ao carregar cronograma" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { tasks } = body;

    if (!Array.isArray(tasks)) {
      return NextResponse.json(
        { ok: false, error: "Formato inválido para tasks (esperado array)." },
        { status: 400 }
      );
    }

    const sql = getSql();
    await ensureTable(sql);

    const result = await sql`
      INSERT INTO obra_catuai_schedule (id, tasks, updated_at)
      VALUES ('main', ${JSON.stringify(tasks)}::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        tasks = EXCLUDED.tasks,
        updated_at = NOW()
      RETURNING id, tasks, updated_at
    `;

    return NextResponse.json({
      ok: true,
      tasks: result[0].tasks,
      updatedAt: result[0].updated_at,
    });
  } catch (error: any) {
    console.error("PUT /api/schedule error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Erro ao salvar cronograma" },
      { status: 500 }
    );
  }
}
