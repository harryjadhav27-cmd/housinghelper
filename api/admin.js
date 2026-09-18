const crypto=require('crypto');
const GH='https://api.github.com';
function auth(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):''}
function tokenFor(password){return crypto.createHmac('sha256',process.env.ADMIN_PASSWORD||'').update(password).digest('hex')}
async function gh(path,opts={}){const r=await fetch(GH+path,{...opts,headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.message||'GitHub API error');return d}
async function getProps(){const d=await gh('/repos/harryjadhav27-cmd/housinghelper/contents/properties.json?ref=main');return {props:JSON.parse(Buffer.from(d.content,'base64').toString('utf8')),sha:d.sha}}
async function put(path,encoded,message,sha){const body={message,content:encoded,branch:'main'};if(sha)body.sha=sha;return gh('/repos/harryjadhav27-cmd/housinghelper/contents/'+path,{method:'PUT',body:JSON.stringify(body)})}
module.exports=async(req,res)=>{
try{
 if(req.method==='POST'&&req.body?.action==='login'){if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN)return res.status(500).json({ok:false,error:'Admin is not configured. Add ADMIN_PASSWORD and GITHUB_TOKEN in Vercel.'});if(req.body.password!==process.env.ADMIN_PASSWORD)return res.status(401).json({ok:false,error:'Invalid password'});return res.json({ok:true,token:tokenFor(req.body.password)})}
 if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN)return res.status(500).json({ok:false,error:'Admin is not configured in Vercel.'});
 if(auth(req)!==tokenFor(process.env.ADMIN_PASSWORD))return res.status(401).json({ok:false,error:'Unauthorized'});
 const {props,sha}=await getProps();
 if(req.method==='GET')return res.json({ok:true,properties:props});
 if(req.method==='POST'&&req.body?.action==='add'){
  if(!req.body.photo?.data||!req.body.photo?.mime?.startsWith('image/'))return res.status(400).json({ok:false,error:'A valid image is required'});
  if(Buffer.byteLength(req.body.photo.data,'base64')>5*1024*1024)return res.status(400).json({ok:false,error:'Image must be 5MB or smaller'});
  const id=crypto.randomUUID();const safe=String(req.body.photo.name||'photo.jpg').replace(/[^a-zA-Z0-9._-]/g,'-');const p={id,...req.body.property,image:'/property-images/'+id+'-'+safe,createdAt:new Date().toISOString()};
  await put(p.image,req.body.photo.data,'Upload property photo');props.unshift(p);await put('properties.json',Buffer.from(JSON.stringify(props,null,2)).toString('base64'),'Add property listing',sha);return res.json({ok:true,property:p});
 }
 if(req.method==='POST'&&req.body?.action==='remove'){const next=props.filter(x=>x.id!==req.body.id);await put('properties.json',Buffer.from(JSON.stringify(next,null,2)).toString('base64'),'Remove property listing',sha);return res.json({ok:true})}
 return res.status(405).json({ok:false,error:'Method not allowed'});
}catch(e){return res.status(500).json({ok:false,error:e.message})}}
