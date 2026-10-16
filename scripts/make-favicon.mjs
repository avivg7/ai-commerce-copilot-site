// One-off: public/favicon.ico (a 32x32 PNG inside an ICO container) from the brand icon. node scripts/make-favicon.mjs
import sharp from "sharp";
import fs from "node:fs";
const png = await sharp("public/brand/icon-192.png").resize(32, 32).png().toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 32; head[7] = 32; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync("public/favicon.ico", Buffer.concat([head, png]));
console.log("public/favicon.ico", 22 + png.length, "bytes");
