const mysql = require('mysql2/promise');
(async ()=>{
  const conn = await mysql.createConnection({host:'127.0.0.1', user:'root', password:'', database:'litloom_db'});
  try{
    const fkName = 'strapi_workflows_stages_updated_by_id_fk';
    // find if constraint exists on any table
    const [rows] = await conn.execute("SELECT constraint_name, table_name FROM information_schema.key_column_usage WHERE constraint_schema = 'litloom_db' AND constraint_name = ?", [fkName]);
    if (rows.length === 0) {
      console.log('No duplicate FK constraint found:', fkName);
      await conn.end();
      process.exit(0);
    }
    for (const r of rows) {
      const table = r.TABLE_NAME || r.table_name || r.tableName || r.table_name;
      console.log('Found FK', fkName, 'on table', table, '- attempting to drop');
      try {
        await conn.execute(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fkName}\``);
        console.log('Dropped foreign key', fkName, 'from', table);
      } catch (e) {
        console.error('Error dropping fk on', table, e.message);
      }
    }
  }catch(e){
    console.error('error', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
