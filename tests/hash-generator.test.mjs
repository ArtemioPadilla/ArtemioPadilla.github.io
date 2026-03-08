/**
 * Test for MD5 and CRC32 implementations used in HashGenerator component.
 * Run with: node tests/hash-generator.test.mjs
 */

// ─── MD5 Implementation (copied from component for testing) ───

function md5(input) {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }
  const originalLen = input.length;
  const bitLen = originalLen * 8;
  const paddedLen = (((originalLen + 8) >>> 6) << 6) + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[originalLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(offset + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

function toHexLE(n) {
  const bytes = [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── CRC32 Implementation ───

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  CRC32_TABLE[i] = crc;
}

function crc32(input) {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ input[i]) & 0xff];
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

// ─── Hex format helpers ───

function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function hexToBinary(hex) {
  let result = "";
  for (let i = 0; i < hex.length; i++) result += parseInt(hex[i], 16).toString(2).padStart(4, "0");
  return result;
}

// ─── Tests ───

import crypto from "crypto";

const encoder = new TextEncoder();
let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    Expected: ${expected}`);
    console.log(`    Actual:   ${actual}`);
    failed++;
  }
}

console.log("=== MD5 Tests ===");

// Test vectors from RFC 1321
assert("MD5 empty string", md5(encoder.encode("")), "d41d8cd98f00b204e9800998ecf8427e");
assert("MD5 'a'", md5(encoder.encode("a")), "0cc175b9c0f1b6a831c399e269772661");
assert("MD5 'abc'", md5(encoder.encode("abc")), "900150983cd24fb0d6963f7d28e17f72");
assert("MD5 'message digest'", md5(encoder.encode("message digest")), "f96b697d7cb7938d525a2f31aaf161d0");
assert("MD5 'Hello, world!'", md5(encoder.encode("Hello, world!")), "6cd3556deb0da54bca060b4c39479839");
assert("MD5 'abcdefghijklmnopqrstuvwxyz'", md5(encoder.encode("abcdefghijklmnopqrstuvwxyz")), "c3fcd3d76192e4007dfb496cca67e13b");

console.log("\n=== CRC32 Tests ===");

// CRC32 verification using Node.js zlib
import zlib from "zlib";
function nodeCrc32(str) {
  return zlib.crc32(Buffer.from(str)).toString(16).padStart(8, "0");
}

const crc32Inputs = ["", "Hello, world!", "abc", "test", "The quick brown fox jumps over the lazy dog"];
for (const input of crc32Inputs) {
  const expected = nodeCrc32(input);
  const actual = crc32(encoder.encode(input));
  assert(`CRC32 '${input.substring(0, 30)}${input.length > 30 ? "..." : ""}'`, actual, expected);
}

console.log("\n=== Format Conversion Tests ===");

const testHex = "6cd3556deb0da54bca060b4c39479839";
assert("hexToBase64", hexToBase64(testHex), Buffer.from(testHex, "hex").toString("base64"));
assert("hexToBinary starts with correct bits", hexToBinary("ff").substring(0, 8), "11111111");
assert("hexToBinary '00'", hexToBinary("00"), "00000000");
assert("hexToBinary 'a5'", hexToBinary("a5"), "10100101");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
