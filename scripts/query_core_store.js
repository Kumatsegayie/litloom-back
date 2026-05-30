const mysql = require('mysql2/promise');
(async ()=>{
  const conn = await mysql.createConnection({host:'127.0.0.1', user:'root', password:'', database:'litloom_db'});
  try{
    const [rows] = await conn.execute("SELECT `key`, `value` FROM strapi_core_store_settings WHERE `key` LIKE '%content%' OR `key` LIKE '%content-type%' LIMIT 200");
    console.log('rows:', rows.length);
    for (const r of rows) {
      console.log(r.key, r.value && r.value.slice ? r.value.slice(0,200) : r.value);
    }
  }catch(e){
    console.error(e.message);
  } finally {
    await conn.end();
  }
})();
