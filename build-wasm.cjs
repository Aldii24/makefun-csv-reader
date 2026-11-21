// Builds csv.wat with wabt (npm i wabt) and writes the module's base64 into fast.js's WASM_B64.
// usage: node gen-wat.mjs simd csv.wat && node build-wasm.cjs csv.wat fast.js
const fs = require('fs');
const [, , watPath, jsPath] = process.argv;
require('wabt')().then((w) => {
  const m = w.parseWat(watPath, fs.readFileSync(watPath, 'utf8'), { simd: true, bulk_memory: true });
  const b64 = Buffer.from(m.toBinary({}).buffer).toString('base64');
  const js = fs.readFileSync(jsPath, 'utf8').replace(/const WASM_B64 = "[^"]*";/, `const WASM_B64 = "${b64}";`);
  fs.writeFileSync(jsPath, js);
  console.log('module bytes', Buffer.from(b64, 'base64').length);
});
