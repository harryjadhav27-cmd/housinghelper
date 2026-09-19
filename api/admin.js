const crypto=require('crypto');
const GH='https://api.github.com';
function auth(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):''}
function tokenFor(password){return crypto.createHmac('sha256',process.env.ADMIN_PASSWORD||'').update(password).digest('hex')}
function seal(obj){const key=crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD||'').digest();const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(obj),'utf8'),c.final()]);return iv.toString('base64')+'.'+c.getAuthTag().toString('base64')+'.'+data.toString('base64')}
function unseal(blob){try{const [iv,tag,data]=String(blob).split('.');const key=crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD||'').digest();const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString('utf8'))}catch{return {}}}
function hydrateProject(p){const q={...p};if(q._private){Object.assign(q,unseal(q._private))}return q}
function storeProject(p){const q={...p};const priv={builderContact:q.builderContact,builderEmail:q.builderEmail,exactAddress:q.exactAddress,reraNumber:q.reraNumber,notes:q.notes,brochure:q.brochure};delete q.builderContact;delete q.builderEmail;delete q.exactAddress;delete q.reraNumber;delete q.notes;delete q.brochure;q._private=seal(priv);return q}
function hydrateProperty(p){const q={...p};if(q._private){Object.assign(q,unseal(q._private))}return q}
function storeProperty(p){const q={...p};const priv={ownerName:q.ownerName,ownerContact:q.ownerContact,exactAddress:q.exactAddress,privateNotes:q.privateNotes,commissionNotes:q.commissionNotes};delete q.ownerName;delete q.ownerContact;delete q.exactAddress;delete q.privateNotes;delete q.commissionNotes;q._private=seal(priv);return q}
async function gh(path,opts={}){const r=await fetch(GH+path,{...opts,headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.message||'GitHub API error');return d}
async function getFile(path){const d=await gh('/repos/harryjadhav27-cmd/housinghelper/contents/'+path+'?ref=main');return {data:JSON.parse(Buffer.from(d.content,'base64').toString('utf8')),sha:d.sha}}
async function put(path,encoded,message,sha){const body={message,content:encoded,branch:'main'};if(sha)body.sha=sha;return gh('/repos/harryjadhav27-cmd/housinghelper/contents/'+path,{method:'PUT',body:JSON.stringify(body)})}
async function getProps(){return getFile('properties.json')}
async function getProjects(){return getFile('projects.json')}
function publicProject(p){return {id:p.id,name:p.name,location:p.location,bhk:p.bhk,price:p.price,size:p.size,possesssion:p.possesssion||p.possession,developer:p.developer,rera:p.rera,image:p.image,description:p.description,active:p.active!==false}}
function publicProperty(p){return {id:p.id,name:p.name,location:p.location,type:p.type,price:p.price,status:p.status,description:p.description,image:p.image,category:p.category||'listing',createdAt:p.createdAt}}
function isAdmin(req){return auth(req)===tokenFor(process.env.ADMIN_PASSWORD)}
module.exports=async(req,res)=>{
try{
 if(req.method==='POST'&&req.body?.action==='login'){
  if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN)return res.status(500).json({ok:false,error:'Admin is not configured. Add ADMIN_PASSWORD and GITHUB_TOKEN in Vercel.'});
  if(req.body.password!==process.env.ADMIN_PASSWORD)return res.status(401).json({ok:false,error:'Invalid password'});
  return res.json({ok:true,token:tokenFor(req.body.password)});
 }
 if(!process.env.ADMIN_PASSWORD||!process.env.GITHUB_TOKEN)return res.status(500).json({ok:false,error:'Admin is not configured in Vercel.'});
 if(req.method==='GET'&&req.query?.public==='1'){
  const [{data:projects},{data:properties}]=await Promise.all([getProjects(),getProps()]);
  return res.json({ok:true,projects:projects.filter(p=>p.active!==false).map(publicProject),properties:properties.map(publicProperty)});
 }
 if(!isAdmin(req))return res.status(401).json({ok:false,error:'Unauthorized'});
 if(req.method==='GET'){
  const [{data:projects},{data:properties}]=await Promise.all([getProjects(),getProps()]);
  return res.json({ok:true,projects:projects.map(hydrateProject),properties:properties.map(hydrateProperty)});
 }
 if(req.method==='POST'){
  const action=req.body?.action;
  if(action==='addProject'||action==='updateProject'){
   const {data:projects,sha}=await getProjects();
   let p=req.body.project||{};
   if(action==='addProject') p={id:crypto.randomUUID(),createdAt:new Date().toISOString(),active:true,...p};
   else {
    const i=projects.findIndex(x=>x.id===p.id); if(i<0)return res.status(404).json({ok:false,error:'Project not found'});
    p={...projects[i],...p};
   }
   if(req.body.image?.data){
    if(!String(req.body.image.mime||'').startsWith('image/'))return res.status(400).json({ok:false,error:'Invalid project image'});
    if(Buffer.byteLength(req.body.image.data,'base64')>5*1024*1024)return res.status(400).json({ok:false,error:'Project image must be 5MB or smaller'});
    const safe=String(req.body.image.name||'project.jpg').replace(/[^a-zA-Z0-9._-]/g,'-');
    p.image='/project-images/'+p.id+'-'+safe;
    await put(p.image,req.body.image.data,'Upload project image');
   }
   if(req.body.brochure?.data){
    if(req.body.brochure.mime!=='application/pdf')return res.status(400).json({ok:false,error:'Brochure must be a PDF'});
    if(Buffer.byteLength(req.body.brochure.data,'base64')>10*1024*1024)return res.status(400).json({ok:false,error:'Brochure must be 10MB or smaller'});
    const safe=String(req.body.brochure.name||'brochure.pdf').replace(/[^a-zA-Z0-9._-]/g,'-');
    p.brochure='/brochures/'+p.id+'-'+safe;
    await put(p.brochure,req.body.brochure.data,'Upload project brochure');
   }   const stored=storeProject(p); if(action==='addProject')projects.unshift(stored); else projects[projects.findIndex(x=>x.id===p.id)]=stored;
   await put('projects.json',Buffer.from(JSON.stringify(projects,null,2)).toString('base64'),action==='addProject'?'Add project':'Update project',sha);
   return res.json({ok:true,project:hydrateProject(stored)});
  }
  if(action==='deleteProject'){
   const {data:projects,sha}=await getProjects();
   const next=projects.filter(x=>x.id!==req.body.id); await put('projects.json',Buffer.from(JSON.stringify(next,null,2)).toString('base64'),'Delete project',sha);
   return res.json({ok:true});
  }
  if(action==='add'||action==='addResale'||action==='updateProperty'){
   const {data:props,sha}=await getProps();
   let p=req.body.property||{};
   if(action==='add'||action==='addResale')p={id:crypto.randomUUID(),createdAt:new Date().toISOString(),active:true,category:action==='addResale'?'resale':'listing',...p};
   else {const i=props.findIndex(x=>x.id===p.id);if(i<0)return res.status(404).json({ok:false,error:'Property not found'});p={...props[i],...p}}
   if(req.body.photo?.data){
    if(!String(req.body.photo.mime||'').startsWith('image/'))return res.status(400).json({ok:false,error:'A valid image is required'});
    if(Buffer.byteLength(req.body.photo.data,'base64')>5*1024*1024)return res.status(400).json({ok:false,error:'Image must be 5MB or smaller'});
    const safe=String(req.body.photo.name||'photo.jpg').replace(/[^a-zA-Z0-9._-]/g,'-');p.image='/property-images/'+p.id+'-'+safe;await put(p.image,req.body.photo.data,'Upload property photo');
   }
   const stored=storeProperty(p); if(action==='add'||action==='addResale')props.unshift(stored);else props[props.findIndex(x=>x.id===p.id)]=stored;
   await put('properties.json',Buffer.from(JSON.stringify(props,null,2)).toString('base64'),action==='updateProperty'?'Update property listing':'Add property listing',sha);
   return res.json({ok:true,property:hydrateProperty(stored)});
  }
  if(action==='remove'){
   const {data:props,sha}=await getProps();const next=props.filter(x=>x.id!==req.body.id);await put('properties.json',Buffer.from(JSON.stringify(next,null,2)).toString('base64'),'Remove property listing',sha);return res.json({ok:true});
  }
 }
 return res.status(405).json({ok:false,error:'Method not allowed'});
}catch(e){const msg=String(e?.message||e||'Server error');if(/bad credentials|authentication|unauthorized/i.test(msg))return res.status(502).json({ok:false,error:'GitHub connection failed: GITHUB_TOKEN is invalid, expired, or does not have access to the housinghelper repository.'});return res.status(500).json({ok:false,error:msg})}}
