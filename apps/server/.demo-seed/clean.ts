import { createDatabase, schema, sql } from "@agenteschat/db";
const { db } = createDatabase({ url: process.argv[2], poolMax: 1 });
const gone = await db.execute(sql`delete from messages where body like 'Ainda não consigo responder%' or meta->>'bodyCode' = 'no_ai' or body like '%no AI connected%' returning id, body`);
console.log("msgs", JSON.stringify(gone).slice(0, 300));
const runs = await db.execute(sql`update agent_runs set status = 'done' where status not in ('done','failed','canceled') returning id, status`);
console.log("runs", JSON.stringify(runs).slice(0, 200));
const st = await db.execute(sql`select status, count(*) from agent_runs group by status`);
console.log(JSON.stringify(st));
process.exit(0);
