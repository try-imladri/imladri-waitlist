import type { WaitlistEnv } from "./config.js";

function ipv4(value:string):number[]|null {
  const parts=value.split(".");
  if(parts.length!==4||parts.some(part=>!/^(?:0|[1-9]\d{0,2})$/.test(part)||Number(part)>255))return null;
  return parts.map(Number);
}

/** Exact addresses only: no hostnames, CIDRs, zones, ports or forwarding lists. */
export function normalizeAdminIp(value:string):string|null {
  if(!value||value.length>64||value!==value.trim())return null;
  if(!value.includes(":")){const bytes=ipv4(value);return bytes?`v4:${bytes.join(".")}`:null;}
  if(!/^[0-9a-f:.]+$/i.test(value))return null;
  let address=value.toLowerCase();
  if(address.includes(".")){
    const index=address.lastIndexOf(":");const bytes=ipv4(address.slice(index+1));if(!bytes)return null;
    address=address.slice(0,index+1)+((bytes[0]<<8)|bytes[1]).toString(16)+":"+((bytes[2]<<8)|bytes[3]).toString(16);
  }
  const halves=address.split("::");if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(":"):[];const right=halves.length===2&&halves[1]?halves[1].split(":"):[];
  if([...left,...right].some(part=>!/^[0-9a-f]{1,4}$/.test(part)))return null;
  const count=left.length+right.length;
  if((halves.length===1&&count!==8)||(halves.length===2&&count>=8))return null;
  const groups=[...left,...Array(halves.length===2?8-count:0).fill("0"),...right].map(part=>parseInt(part,16));
  // RFC 4291 IPv4-mapped IPv6 represents the same connecting address as IPv4.
  if(groups.slice(0,5).every(group=>group===0)&&groups[5]===0xffff)return`v4:${groups[6]>>>8}.${groups[6]&255}.${groups[7]>>>8}.${groups[7]&255}`;
  return"v6:"+groups.map(group=>group.toString(16).padStart(4,"0")).join(":");
}

function normalizedPath(value:string):string {
  const segments:string[]=[];
  for(const segment of value.replace(/\\/g,"/").split("/")){
    if(!segment||segment===".")continue;
    if(segment===".."){segments.pop();continue;}
    segments.push(segment);
  }
  const path=("/"+segments.join("/")).toLowerCase();
  return path.endsWith(".rsc")?path.slice(0,-4):path;
}

/** Mirrors route decoding before routing/cache access, including Flight URLs. */
export function isAdminRequestPath(pathname:string):boolean {
  let current=pathname;
  for(let pass=0;pass<8;pass++){
    const path=normalizedPath(current);
    if(path==="/admin"||path.startsWith("/admin/")||path==="/api/admin"||path.startsWith("/api/admin/"))return true;
    let decoded:string;
    try{decoded=decodeURIComponent(current);}catch{decoded=current.replace(/%([0-9a-f]{2})/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));}
    if(decoded===current)return false;
    current=decoded;
  }
  const path=normalizedPath(current);
  return path==="/admin"||path.startsWith("/admin/")||path==="/api/admin"||path.startsWith("/api/admin/");
}

export function adminNetworkAllowed(request:Request,env:Pick<WaitlistEnv,"ADMIN_ALLOWED_IPS">):boolean {
  // The allowlist is for direct browsers. A same-zone Worker subrequest can
  // affect its connecting-IP header, so it must never inherit this access.
  if(request.headers.has("CF-Worker"))return false;
  const setting=env.ADMIN_ALLOWED_IPS;
  if(typeof setting!=="string"||!setting.trim()||setting.length>2048)return false;
  const allowed=setting.split(",").map(entry=>normalizeAdminIp(entry.trim()));
  if(!allowed.length||allowed.some(value=>value===null))return false;
  // Cloudflare overwrites this header at the public edge. No client-controlled
  // X-Forwarded-For, X-Real-IP, identity header or query parameter is a fallback.
  const connecting=normalizeAdminIp(request.headers.get("CF-Connecting-IP")||"");
  return connecting!==null&&allowed.includes(connecting);
}

export function adminNetworkResponse(request:Request,env:Pick<WaitlistEnv,"ADMIN_ALLOWED_IPS">):Response|null {
  if(!isAdminRequestPath(new URL(request.url).pathname)||adminNetworkAllowed(request,env))return null;
  return new Response(null,{status:303,headers:{Location:"/","Cache-Control":"private, no-store, max-age=0","CDN-Cache-Control":"no-store","Cloudflare-CDN-Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",Vary:"CF-Connecting-IP"}});
}
