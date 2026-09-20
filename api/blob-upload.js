const crypto=require('crypto');
const {handleUpload}=require('@vercel/blob/client');

function tokenFor(password){
  return crypto.createHmac('sha256',password||'').update(password||'').digest('hex');
}

module.exports=async(req,res)=>{
  try{
    if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(500).json({error:'Vercel Blob is not configured. Create a Blob store and connect it to this project so BLOB_READ_WRITE_TOKEN is available.'});
    const body=req.body;
    if(!body)return res.status(400).json({error:'Missing upload request body'});
    if(body.type==='blob.generate-client-token'){
      let payload={};
      try{payload=JSON.parse(body.payload?.clientPayload||'{}')}catch{}
      const expected=process.env.ADMIN_PASSWORD?tokenFor(process.env.ADMIN_PASSWORD):'';
      if(!expected||payload.adminToken!==expected)return res.status(401).json({error:'Unauthorized upload request'});
    }
    const jsonResponse=await handleUpload({
      body,
      request:req,
      token:process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken:async(pathname,clientPayload)=>{
        let payload={};
        try{payload=JSON.parse(clientPayload||'{}')}catch{}
        const expected=process.env.ADMIN_PASSWORD?tokenFor(process.env.ADMIN_PASSWORD):'';
        if(!expected||payload.adminToken!==expected)throw new Error('Unauthorized upload request');
        const isVideo=/\.(mp4|webm|mov)$/i.test(pathname);
        return {
          allowedContentTypes:isVideo?['video/mp4','video/webm','video/quicktime']:['image/jpeg','image/png','image/webp'],
          maximumSizeInBytes:isVideo?250*1024*1024:10*1024*1024,
          addRandomSuffix:true,
          validUntil:Date.now()+15*60*1000
        };
      }
    });
    return res.status(200).json(jsonResponse);
  }catch(e){
    return res.status(400).json({error:e?.message||'Upload authorization failed'});
  }
};
