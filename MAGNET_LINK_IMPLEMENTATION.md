# Magnet Link Fallback Implementation

## Overview

This implementation adds magnet link extraction and fallback support to the Stremio Zamunda addon. When torrent file download or parsing fails, the addon will now use magnet links as a fallback mechanism, improving reliability and user experience.

## Changes Made

### 1. Parser Updates

All three movie parsers have been updated to extract magnet links from HTML:

#### `zamunda-movie-parser.js`
- Added `extractMagnetLinks()` method to parse magnet links from HTML
- Updated `parseMovies()` to call `extractMagnetLinks()` after parsing torrent URLs
- Modified `convertMoviesToTorrents()` to include `magnetUrl` property
- Enhanced `formatTorrentsAsStreams()` with fallback logic:
  1. First tries to parse torrent file for infoHash (preferred)
  2. Falls back to magnet link if torrent parsing fails
  3. Falls back to torrent URL as last resort
- Added logging when magnet links are used

#### `arenabg-movie-parser.js`
- Added `extractMagnetLinks()` method
- Updated movie object structure to include `magnetUrl: null`
- Modified `convertMoviesToTorrents()` to include `magnetUrl` property
- Enhanced `formatTorrentsAsStreams()` with same fallback logic
- Added logging when magnet links are used

#### `zamunda-se-movie-parser.js`
- Added `extractMagnetLinks()` method
- Updated movie object structure to include `magnetUrl: null`
- Modified `convertMoviesToTorrents()` to include `magnetUrl` property
- Enhanced `formatTorrentsAsStreams()` with fallback logic:
  1. First tries to download and parse torrent
  2. Falls back to magnet link if torrent download/parse fails
  3. Falls back to torrent URL as last resort
- Added logging when magnet links are used

### 2. Magnet Link Extraction Logic

The `extractMagnetLinks()` method uses a two-pronged approach:

1. **DOM-based extraction**: Uses `querySelectorAll('a[href^="magnet:"]')` to find magnet link anchors
2. **Regex fallback**: If DOM parsing doesn't find magnet links, uses regex pattern: `/href=["'](magnet:\?xt=urn:btih:[^"']+)["']/gi`

This ensures maximum compatibility across different HTML structures.

### 3. Stream Fallback Priority

The stream formatting now follows this priority order:

```
1. infoHash from parsed torrent (BEST - enables DHT, PEX, etc.)
   ↓ (if torrent download/parse fails)
2. Magnet link URL (GOOD - direct streaming)
   ↓ (if no magnet link available)
3. Torrent file URL (FALLBACK - requires download by client)
```

### 4. Backward Compatibility

- All changes are backward compatible
- If no magnet link is found, behavior remains unchanged
- Existing torrent download flow is preserved
- Stream format remains consistent with Stremio requirements

## Testing

Two comprehensive test files were added:

### `test/test-magnet-extraction.js`
Tests that all parsers can extract magnet links from HTML:
- Creates mock HTML with magnet links
- Verifies parsers extract magnet URLs
- Checks that magnet URLs are included in torrent objects
- All parsers pass extraction tests ✅

### `test/test-magnet-fallback.js`
Tests the fallback mechanism when torrent download fails:
- Creates mock torrents with magnet links
- Simulates torrent download failure
- Verifies that magnet links are used as fallback
- Confirms proper logging
- All parsers pass fallback tests ✅

## Running Tests

```bash
# Install dependencies
npm install

# Run magnet extraction test
node test/test-magnet-extraction.js

# Run magnet fallback test
node test/test-magnet-fallback.js

# Run existing tests
node test/test-resolution.js
```

## Expected Behavior

### Scenario 1: Torrent Download Succeeds
```
1. Parser extracts torrent URL and magnet URL from HTML
2. Addon downloads torrent file
3. Addon parses torrent to get infoHash
4. Stream returned with infoHash (optimal)
```

### Scenario 2: Torrent Download Fails, Magnet Available
```
1. Parser extracts torrent URL and magnet URL from HTML
2. Addon attempts to download torrent (fails)
3. Addon uses magnet URL as fallback
4. Stream returned with magnet URL
5. Log message: "[Tracker] Using magnet link as fallback for: [title]"
```

### Scenario 3: No Magnet Link Available
```
1. Parser extracts torrent URL only
2. Addon attempts to download torrent (fails)
3. Addon uses torrent URL as fallback
4. Stream returned with torrent URL (existing behavior)
```

## Logging

New log messages indicate when magnet links are used:

```javascript
console.log(`[Zamunda] Using magnet link as fallback for: ${torrent.title.trim()}`);
console.log(`[ArenaBG] Using magnet link as fallback for: ${torrent.title.trim()}`);
console.log(`[Zamunda.se] Using magnet link as fallback for: ${torrent.title}`);
```

## Code Quality

- All methods include JSDoc comments
- Error handling is consistent across parsers
- Logging provides clear debugging information
- No breaking changes to existing functionality
- Follows existing code style and patterns

## Future Enhancements

Potential improvements for future iterations:

1. Extract magnet links from torrent detail pages (not just search results)
2. Cache magnet links to reduce HTML parsing overhead
3. Add configuration option to prefer magnet links over torrent files
4. Implement magnet link validation (check for required components)
5. Add metrics to track magnet link usage vs torrent file usage

## Notes

- Magnet links are standard on torrent tracker sites
- If a tracker doesn't provide magnet links, the feature gracefully degrades
- The implementation assumes magnet links appear in the same order as torrents
- Regex fallback ensures compatibility with various HTML encodings
