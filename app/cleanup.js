import * as db from './db.js';

// Text and feedback are retained. Only thumbnails owned by this application are eligible.
export async function cleanupImages() {
  const cutoff=new Date(Date.now()-180*86400000).toISOString();
  let afterId=0;
  while(true) {
    const candidates=await db.query("SELECT id, image_path FROM items WHERE id>? AND is_starred=0 AND image_path IS NOT NULL AND julianday(collected_at)<julianday(?) ORDER BY id LIMIT 50",[afterId,cutoff],50);
    if(!candidates.length)break;
    for(const item of candidates) {
      afterId=item.id;
      if(!/^images\/\d{4}-\d{2}\/[0-9a-f]{16}\.jpg$/.test(item.image_path))continue;
      // Claim the reference before doing file work outside the transaction.
      // A favorite saved before this claim wins; shared paths are never removed.
      const [claim,references]=await db.transaction([
        {sql:'UPDATE items SET image_path=NULL WHERE id=? AND image_path=? AND is_starred=0 AND julianday(collected_at)<julianday(?)',params:[item.id,item.image_path,cutoff]},
        {sql:'SELECT COUNT(*) AS count FROM items WHERE image_path=?',params:[item.image_path]},
      ]);
      if(!claim.changes || references.rows[0].count)continue;
      try {await window.panda.files.remove(item.image_path);}
      catch(error) {
        // Preserve a retryable reference when the platform could not remove the file.
        await db.execute('UPDATE items SET image_path=? WHERE id=? AND image_path IS NULL',[item.image_path,item.id]);
        console.warn('配图清理暂未完成',error);
      }
    }
    if(candidates.length<50)break;
  }
}
