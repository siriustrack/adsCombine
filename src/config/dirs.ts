import path from 'node:path';
import fs from 'node:fs';

export const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
export const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');
export const TEXTS_DIR = path.join(__dirname, '..', '..', 'public', 'texts');
export const IMGS_DIR = path.join(PUBLIC_DIR, 'imgs');
export const FEED_IMGS_DIR = path.join(IMGS_DIR, 'feed');
export const STORY_IMGS_DIR = path.join(IMGS_DIR, 'story');
export const FEED_FULLY_IMGS_DIR = path.join(IMGS_DIR, 'feed-fully');
export const STORY_FULLY_IMGS_DIR = path.join(IMGS_DIR, 'story-fully');
export const ASSETS_IMG = path.join(__dirname, '..', '..', 'assets-img');
export const FEED_DIR = path.join(PUBLIC_DIR, 'feed');
export const STORY_TARJAS_DIR = path.join(PUBLIC_DIR, 'story_tarjas');
export const STORY_FULLSCREEN_DIR = path.join(PUBLIC_DIR, 'story_fullscreen');


if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(TEXTS_DIR)) fs.mkdirSync(TEXTS_DIR, { recursive: true });
if (!fs.existsSync(IMGS_DIR)) fs.mkdirSync(IMGS_DIR, { recursive: true });
if (!fs.existsSync(FEED_IMGS_DIR)) fs.mkdirSync(FEED_IMGS_DIR, { recursive: true });
if (!fs.existsSync(STORY_IMGS_DIR)) fs.mkdirSync(STORY_IMGS_DIR, { recursive: true });
if (!fs.existsSync(FEED_FULLY_IMGS_DIR)) fs.mkdirSync(FEED_FULLY_IMGS_DIR, { recursive: true });
if (!fs.existsSync(STORY_FULLY_IMGS_DIR)) fs.mkdirSync(STORY_FULLY_IMGS_DIR, { recursive: true });
if (!fs.existsSync(FEED_DIR)) fs.mkdirSync(FEED_DIR, { recursive: true });
if (!fs.existsSync(STORY_TARJAS_DIR)) fs.mkdirSync(STORY_TARJAS_DIR, { recursive: true });
if (!fs.existsSync(STORY_FULLSCREEN_DIR)) fs.mkdirSync(STORY_FULLSCREEN_DIR, { recursive: true });
