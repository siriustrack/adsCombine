import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
export const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');
export const TEXTS_DIR = path.join(__dirname, '..', '..', 'public', 'texts');
export const JOBS_DIR = path.join(TEMP_DIR, 'jobs');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(TEXTS_DIR)) fs.mkdirSync(TEXTS_DIR, { recursive: true });
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
