const mysql = require('mysql2/promise');
(async ()=>{
  try{
    const conn = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: '', database: 'information_schema'});
    const [tables] = await conn.execute("SELECT table_name FROM tables WHERE table_schema='litloom_db' AND table_name LIKE '%permission%';");
    console.log('permission-like tables in litloom_db:');
    console.log(tables.map(r=>r.TABLE_NAME).join('\n') || '(none)');
    await conn.end();

    // connect to litloom_db and inspect permission rows
    const db = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: '', database: 'litloom_db'});
    // try common table names
    const candidates = ['plugin_users_permissions_permission','plugin__users-permissions_permission','plugin__users_permissions_permission','plugin__users_permissions_permission','users_permissions_permission','plugin_users_permissions_permissions','plugin_users_permissions_permission'];
    for (const t of candidates) {
      try {
        const [rows] = await db.execute(`SELECT COUNT(*) as c FROM \`${t}\` LIMIT 1`);
        if (rows && rows.length) {
          console.log(`found table: ${t}`);
          const [sample] = await db.execute(`SELECT action, role, enabled, id FROM \`${t}\` WHERE action LIKE '%paintings%' LIMIT 10`);
          console.log('sample rows for paintings (if any):', sample.length ? sample : '(none)');
        }
      } catch (e) {
        // ignore
      }
    }

    // also query any permission-like table discovered earlier
    for (const r of tables) {
      const t = r.TABLE_NAME || r.table_name || r.TABLE_NAME;
      try {
        const [sample] = await db.execute(`SELECT action, role, enabled, id FROM \`${t}\` WHERE action LIKE '%paintings%' LIMIT 10`);
        console.log(`sample rows in ${t}:`, sample.length ? sample : '(none)');
      } catch (e) {
        // ignore
      }
    }

    await db.end();
  }catch(e){
    console.error('error',e.message);
    process.exitCode=1;
  }
})();
