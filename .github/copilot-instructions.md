# Copilot Instructions for Stremio Zamunda Addon

## Project Overview
**Type**: Stremio addon (Node.js application)  
**Purpose**: Enables streaming torrents from Bulgarian torrent trackers (Zamunda.net, Zamunda.ch, Zamunda.se, ArenaBG.com) in Stremio  
**Runtime**: Node.js 20+ (tested with v24.9.0), npm 11+  
**Framework**: stremio-addon-sdk v1.6.10  
**Deployment**: Local server + Vercel serverless

## Critical Setup Requirements

### Environment Configuration
**ALWAYS** create a `.env` file before running ANY commands. Copy from `.env.example`:
```bash
cp .env.example .env
```

Required variables in `.env`:
- `PORT=7000` (server port)
- `ZAMUNDA_NET_USERNAME` and `ZAMUNDA_NET_PASSWORD` (Zamunda.net credentials)
- `ZAMUNDA_CH_USERNAME` and `ZAMUNDA_CH_PASSWORD` (Zamunda.ch credentials)
- `ZAMUNDA_SE_USERNAME` and `ZAMUNDA_SE_PASSWORD` (Zamunda.se credentials)
- `ARENABG_USERNAME` and `ARENABG_PASSWORD` (ArenaBG credentials)
- `ZAMUNDA_NET`, `ZAMUNDA_CH`, `ZAMUNDA_SE`, `ARENABG_COM` (true/false - tracker toggles)
- `OMDB_API_KEY` (optional, for better title matching)

**Without valid `.env`, all tests will fail with authentication errors.**

### Installation
```bash
npm install
```
**Always run before first use.** No build step required - pure JavaScript runtime.

## Running & Testing

### Start Local Server
```bash
npm start
# or
node server.js
```
Server runs on `http://localhost:7000`. Access manifest at `/manifest.json`.

### Run All Tests (Recommended)
```bash
node test/run-all-tests.js
```
**Expected**: 8 tests pass in ~15 seconds. Requires valid tracker credentials in `.env`.  
**Known Issue**: Deprecation warning about child process args (safe to ignore).

### Run Individual Tests
```bash
node test/test-login.js           # Test tracker authentication
node test/test-zamunda-ch.js      # Test Zamunda.ch (GET-based login)
node test/test-zamunda-se.js      # Test Zamunda.se (HTTP, old version)
node test/test-search-by-title.js # Search functionality
node test/test-bulgarian-audio-flag.js # Audio detection
```

**All tests require:**
1. Valid `.env` with tracker credentials
2. Internet connection to reach trackers
3. Working tracker accounts (same credentials work for Zamunda/ArenaBG)

## Architecture & Key Files

### Core Entry Points
- **`server.js`** - Local development HTTP server (port 7000)
- **`serverless.js`** - Vercel serverless function handler
- **`src/addon.js`** - Main addon logic, stream handler, multi-tracker orchestration

### Tracker APIs (4 separate implementations)
- **`src/trackers/zamunda.js`** - Zamunda.net (POST login, new HTML structure)
- **`src/trackers/zamunda-ch.js`** - Zamunda.ch (GET login via URL params)
- **`src/trackers/zamunda-se.js`** - Zamunda.se (HTTP protocol, `/catalogue.php` search)
- **`src/trackers/arenabg.js`** - ArenaBG.com (POST login, two-step download process)

### HTML Parsers
- **`src/parsers/zamunda-movie-parser.js`** - Parses Zamunda.net/Zamunda.ch HTML (newer structure)
- **`src/parsers/zamunda-se-movie-parser.js`** - Parses Zamunda.se HTML (legacy structure from 10 years ago)
- **`src/parsers/arenabg-movie-parser.js`** - Parses ArenaBG HTML with Bulgarian audio detection

### Utilities
- **`src/utils/torrentFileManager.js`** - In-memory LRU cache (max 50 torrents, no filesystem)

### Configuration
- **`now.json`** - Vercel deployment config (routes all traffic to `serverless.js`)
- **`package.json`** - Scripts: `npm start` (server), `npm test` (all tests)
- **`.env`** - Credentials & tracker toggles (**NEVER commit this file**)

## Key Implementation Details

### Multi-Tracker System
Addon supports **dynamic tracker enabling/disabling** via `.env`:
```env
ZAMUNDA_NET=false   # Disable Zamunda.net
ZAMUNDA_CH=true     # Enable Zamunda.ch
ZAMUNDA_SE=true     # Enable Zamunda.se
ARENABG_COM=false   # Disable ArenaBG
```
Only enabled trackers are initialized in `addon.js`. All enabled trackers are searched **in parallel**.

### Zamunda.se Special Notes
- **Uses HTTP (not HTTPS)**: `http://zamunda.se`
- **Old HTML structure**: Requires `zamunda-se-movie-parser.js` (different from .net/.ch)
- **Search URL**: `/catalogue.php?search=X&catalog=movies` (not `/catalogs/movies`)
- **Login**: POST to `http://zamunda.se/login.php` (standard POST, not GET)

### Zamunda.ch Special Notes
- **GET-based login**: `https://zamunda.ch/takelogin.php?username=X&password=Y`
- **Uses dedicated credentials**: `ZAMUNDA_CH_USERNAME` and `ZAMUNDA_CH_PASSWORD`

### ArenaBG Two-Step Download
ArenaBG requires visiting detail page first to extract download key before getting torrent:
1. Search results → detail page URL
2. Visit detail page → extract download key from HTML
3. Construct download URL with key

### Text Encoding
All trackers use **Windows-1251** (Cyrillic) encoding. Always decode with:
```javascript
const decoder = new TextDecoder('windows-1251');
const html = decoder.decode(response.data);
```

### In-Memory Caching
**No filesystem access** (Vercel compatibility). All torrent files cached in memory:
- Max 50 torrents
- LRU eviction
- OMDb API responses cached 24h

## Common Pitfalls & Workarounds

### Test Failures
❌ **"Login failed"** → Check credentials in `.env`, verify tracker is accessible  
❌ **"404 on search"** → Zamunda.se uses different URL (`/catalogue.php` not `/catalogs/movies`)  
❌ **"No results parsed"** → Wrong parser for tracker (Zamunda.se needs custom parser)  
❌ **Encoding issues (Cyrillic garbled)** → Must use `TextDecoder('windows-1251')`

### Server Won't Start
❌ **Port already in use** → Change `PORT` in `.env`  
❌ **Module not found** → Run `npm install`  
❌ **dotenv errors** → Create `.env` from `.env.example`

## Validation Steps

### Before Committing Code
1. **Run full test suite**: `node test/run-all-tests.js` (must pass 8/8 tests)
2. **Start server**: `npm start` (should start without errors)
3. **Test manifest**: Visit `http://localhost:7000/manifest.json` (should return JSON)
4. **Verify `.env` not committed**: Check `.gitignore` includes `.env`

### Testing New Tracker Features
1. Add test file in `test/` directory
2. Use `require('dotenv').config()` at top
3. Initialize API class with `process.env.ZAMUNDA_USERNAME/PASSWORD`
4. Test login → search → parse → format pipeline
5. Add to `test/run-all-tests.js` test file list

## File Locations Reference

### Root Directory Files
```
server.js             - Local HTTP server
serverless.js         - Vercel handler
package.json          - Dependencies & scripts
now.json              - Vercel config
.env                  - Credentials (NEVER commit)
.env.example          - Template for .env
.gitignore            - Excludes node_modules, .env, logs
src/
  addon.js            - Main addon interface (stream handler)
  trackers/
    zamunda.js        - Zamunda.net API
    zamunda-ch.js     - Zamunda.ch API (GET login)
    zamunda-se.js     - Zamunda.se API (HTTP, old version)
    arenabg.js        - ArenaBG API
  parsers/
    zamunda-movie-parser.js     - Parser for .net/.ch
    zamunda-se-movie-parser.js  - Parser for .se (legacy)
    arenabg-movie-parser.js     - Parser for ArenaBG
  utils/
    torrentFileManager.js       - In-memory cache
```

### Test Directory (`test/`)
```
run-all-tests.js      - Test runner (runs all tests)
test-login.js         - Authentication tests
test-zamunda-ch.js    - Zamunda.ch tests
test-zamunda-se.js    - Zamunda.se tests
test-search-by-title.js - Search tests
test-bulgarian-audio-flag.js - Audio detection
test-download-keys.js - ArenaBG download key extraction
test-live-search.js   - Live search tests
test-parse.js         - HTML parser tests
test-resolution.js    - Quality detection tests
test-arenabg-parser.js - ArenaBG parser tests
```

## Trust These Instructions
These instructions are accurate as of the last validation. **Only search for additional information if:**
- Instructions are incomplete for your specific task
- You encounter errors not documented here
- File paths or commands fail as described

Otherwise, follow these steps precisely to minimize exploration time.
