#!/usr/bin/env node
/**
 * Updates metadata.lastUpdated (and optionally bumps patch version) in cv-data.json before a release.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'data', 'cv-data.json');

function loadJSON(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function saveJSON(p,obj){fs.writeFileSync(p, JSON.stringify(obj,null,2)+"\n","utf8");}

function bumpPatchVersion(v){
  const parts = v.split('.').map(Number);
  if(parts.length!==3) return v;
  parts[2] += 1;
  return parts.join('.');
}

function main(){
  const data = loadJSON(jsonPath);
  if(!data.metadata) data.metadata = {};
  const today = new Date().toISOString().slice(0,10);
  data.metadata.lastUpdated = today;
  if(data.metadata.version){
    data.metadata.version = bumpPatchVersion(data.metadata.version);
  } else {
    data.metadata.version = '1.0.0';
  }
  saveJSON(jsonPath, data);
  console.log('Updated metadata: version', data.metadata.version, 'lastUpdated', data.metadata.lastUpdated);
}

main();
