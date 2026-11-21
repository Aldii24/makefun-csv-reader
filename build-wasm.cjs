const fs=require('fs'); const [,,watPath,outBin,outJs]=process.argv;
require('wabt')().then(w=>{ const m=w.parseWat(watPath, fs.readFileSync(watPath,'utf8'), {simd:true,bulk_memory:true});
 const {buffer}=m.toBinary({}); fs.writeFileSync(outBin, Buffer.from(buffer));
 const old=fs.existsSync(outJs)?fs.readFileSync(outJs,'utf8'):'';
 const b64=Buffer.from(buffer).toString('base64');
 const hdr=old.split('\n').filter(l=>l.startsWith('//')).join('\n');
 fs.writeFileSync(outJs, (hdr?hdr+'\n':'')+'export const WASM_B64 = "'+b64+'";\n'); console.log('bytes',buffer.length); });
