const mysql = require('mysql2/promise');
(async ()=>{
  try{
    const db = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: '', database: 'information_schema'});
    const [rows] = await db.execute("SELECT table_name FROM tables WHERE table_schema='litloom_db' ORDER BY table_name LIMIT 500");
    console.log('tables in litloom_db (count', rows.length,')');
    console.log(JSON.stringify(rows.slice(0,50), null, 2));
    await db.end();
  }catch(e){ console.error('error', e.message); process.exitCode=1 }
})();
