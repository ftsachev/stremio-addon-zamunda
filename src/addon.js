const { addonBuilder } = require("stremio-addon-sdk");
const ZamundaAPI = require('./trackers/zamunda.js');
const ZamundaCHAPI = require('./trackers/zamunda-ch.js');
const ZamundaSEAPI = require('./trackers/zamunda-se.js');
const ArenaBGAPI = require('./trackers/arenabg.js');
require('dotenv').config();

// Use environment variables
const OMDB_API_KEY = process.env.OMDB_API_KEY;

// Parse tracker enable/disable flags
const TRACKERS_ENABLED = {
    zamundaNet: process.env.ZAMUNDA_NET === 'true',
    zamundaCh: process.env.ZAMUNDA_CH === 'true',
    zamundaSe: process.env.ZAMUNDA_SE === 'true',
    arenabg: process.env.ARENABG_COM === 'true'
};

// Initialize tracker APIs based on configuration
const trackers = {};

// Initialize Zamunda.net if enabled
if (TRACKERS_ENABLED.zamundaNet) {
    trackers.zamundaNet = new ZamundaAPI({
        username: process.env.ZAMUNDA_NET_USERNAME,
        password: process.env.ZAMUNDA_NET_PASSWORD
    });
}

// Initialize Zamunda.ch if enabled
if (TRACKERS_ENABLED.zamundaCh) {
    trackers.zamundaCh = new ZamundaCHAPI({
        username: process.env.ZAMUNDA_CH_USERNAME,
        password: process.env.ZAMUNDA_CH_PASSWORD
    });
}

// Initialize Zamunda.se if enabled
if (TRACKERS_ENABLED.zamundaSe) {
    trackers.zamundaSe = new ZamundaSEAPI({
        username: process.env.ZAMUNDA_SE_USERNAME,
        password: process.env.ZAMUNDA_SE_PASSWORD
    });
}

// Initialize ArenaBG if enabled
if (TRACKERS_ENABLED.arenabg) {
    trackers.arenabg = new ArenaBGAPI({
        username: process.env.ARENABG_USERNAME,
        password: process.env.ARENABG_PASSWORD
    });
}

console.log('Enabled trackers:', Object.keys(trackers).join(', '));

const manifest = {
    "id": "org.stremio.zamunda",
    "version": "1.3.0",
    "name": "Zamunda",
    "description": "Stream torrents from Zamunda.net",
    "resources": ["stream"],
    "types": ["movie"],
    "catalogs": [],
    "idPrefixes": ["tt"],
    "behaviorHints": {
        "adult": false
    }
};

// Simple in-memory OMDB cache to reduce duplicate requests
const omdbCache = new Map();
const OMDB_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getCachedOmdb(id) {
    const entry = omdbCache.get(id);
    if (!entry) return null;
    if (Date.now() - entry.t > OMDB_TTL_MS) {
        omdbCache.delete(id);
        return null;
    }
    return entry.v;
}

function setCachedOmdb(id, value) {
    omdbCache.set(id, { v: value, t: Date.now() });
}

const builder = new addonBuilder(manifest);

// Stream handler
builder.defineStreamHandler(async function(args) {
    let title = "Unknown Title";
    const imdbId = args.id.split(":")[0];

    try {
        // Get movie title from OMDB (with cache)
        let data = getCachedOmdb(imdbId);
        if (!data) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            try {
                const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                data = await res.json();
                if (data && data.Response !== 'False') setCachedOmdb(imdbId, data);
            } catch (error) {
                clearTimeout(timeoutId);
                console.error('OMDB API request failed:', error.message);
                data = null;
            }
        }
        
        // Check if we have valid data
        if (!data || !data.Title) {
            console.log(`No OMDB data for ${imdbId}`);
            return { streams: [] };
        }
        
        title = data.Title;
        console.log(`🔍 Searching for: ${title} (${data.Year || 'unknown year'})`);
        
        // Ensure all enabled trackers are initialized
        const initPromises = Object.values(trackers).map(tracker => tracker.ensureInitialized());
        await Promise.all(initPromises);
        
        // Search all enabled trackers in parallel
        const searchPromises = [];
        const trackerNames = [];
        
        if (trackers.zamundaNet) {
            searchPromises.push(
                trackers.zamundaNet.searchByTitle(data.Title, data.Year).catch(err => {
                    console.error('Zamunda.net search error:', err.message);
                    return [];
                })
            );
            trackerNames.push('zamundaNet');
        }
        
        if (trackers.zamundaCh) {
            searchPromises.push(
                trackers.zamundaCh.searchByTitle(data.Title, data.Year).catch(err => {
                    console.error('Zamunda.ch search error:', err.message);
                    return [];
                })
            );
            trackerNames.push('zamundaCh');
        }
        
        if (trackers.zamundaSe) {
            searchPromises.push(
                trackers.zamundaSe.searchByTitle(data.Title, data.Year).catch(err => {
                    console.error('Zamunda.se search error:', err.message);
                    return [];
                })
            );
            trackerNames.push('zamundaSe');
        }
        
        if (trackers.arenabg) {
            searchPromises.push(
                trackers.arenabg.searchByTitle(data.Title, data.Year).catch(err => {
                    console.error('ArenaBG search error:', err.message);
                    return [];
                })
            );
            trackerNames.push('arenabg');
        }
        
        const searchResults = await Promise.all(searchPromises);
        
        // Map results to tracker names
        const trackerResults = {};
        trackerNames.forEach((name, index) => {
            trackerResults[name] = searchResults[index];
        });
        
        // Combine results from all trackers
        const allTorrents = searchResults.flat();
        
        if (allTorrents.length > 0) {
            // Format torrents from all sources
            console.log('📦 Starting to format torrents as streams...');
            
            const formatPromises = [];
            trackerNames.forEach(name => {
                if (trackerResults[name].length > 0) {
                    formatPromises.push(
                        trackers[name].formatTorrentsAsStreams(trackerResults[name]).catch(err => {
                            console.error(`Error formatting ${name} streams:`, err.message);
                            return [];
                        })
                    );
                } else {
                    formatPromises.push(Promise.resolve([]));
                }
            });
            
            const formattedStreams = await Promise.all(formatPromises);
            
            console.log('✅ Formatting complete');
            const allStreams = formattedStreams.flat();
            
            // Log results per tracker
            trackerNames.forEach((name, index) => {
                const count = formattedStreams[index].length;
                if (count > 0) {
                    console.log(`Found ${count} ${name} streams for ${data.Title} (${imdbId})`);
                }
            });
            
            console.log(`Total streams to return: ${allStreams.length}`);
            if (allStreams.length > 0) {
                console.log(`First stream sample:`, JSON.stringify(allStreams[0]).substring(0, 200));
            }
            return { streams: allStreams };
        } else {
            console.log(`No torrents found for ${data.Title} (${imdbId})`);
            return { streams: [] };
        }
    } catch (error) {
        console.error("Error fetching data:", error);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();
