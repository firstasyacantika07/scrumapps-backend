const db = require('./config/db'); 
async function test() { 
  try { 
    const r = await db.query('SHOW COLUMNS FROM tbr_projects');
    console.log(r[0]); 
  } catch(e) { 
    console.error('ERROR', e); 
  } finally { 
    process.exit(); 
  } 
} 
test();
