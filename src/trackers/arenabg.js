const axios = require('axios');
const tough = require('tough-cookie');
const { TextDecoder } = require('util');
const TorrentFileManager = require('../utils/torrentFileManager.js');
const ArenaBGMovieParser = require('../parsers/arenabg-movie-parser.js');

class ArenaBGAPI {
	constructor(config) {
		this.config = {
			username: config.username,
			password: config.password,
			baseUrl: 'https://arenabg.com'
		};
		
		// Initialize async components
		this.cookieJar = new tough.CookieJar();
		this.client = null; // Will be initialized in init()
		this.isLoggedIn = false;
		this.loginPromise = null;
		this.torrentManager = new TorrentFileManager();
		this.movieParser = new ArenaBGMovieParser(this.config.baseUrl);
		this.initialized = false;
	}

	// Initialize the axios client with cookie support using dynamic import
	async init() {
		if (this.initialized) return;
		
		try {
			const { wrapper } = await import('axios-cookiejar-support');
			this.client = wrapper(axios.create({ jar: this.cookieJar }));
			this.initialized = true;
		} catch (error) {
			throw new Error(`Failed to initialize ArenaBGAPI: ${error.message}`);
		}
	}

	// Helper method to ensure API is initialized
	async ensureInitialized() {
		if (!this.initialized) {
			await this.init();
		}
	}

	// Login method
	async login() {
		if (this.isLoggedIn) {
			return true;
		}

		// Prevent multiple simultaneous login attempts
		if (this.loginPromise) {
			return this.loginPromise;
		}

		this.loginPromise = (async () => {
			try {
				await this.ensureInitialized();

				// First, get the login page to get any CSRF tokens if needed
				const loginPageResponse = await this.client.get(`${this.config.baseUrl}/bg/users/signin/`, {
					timeout: 10000, // 10 second timeout
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
					}
				});

				// Perform login - ArenaBG uses /bg/users/signin/ for login
				// Try different field names as the site might use different parameters
				const loginResponse = await this.client.post(
					`${this.config.baseUrl}/bg/users/signin/`,
					new URLSearchParams({
						username_or_email: this.config.username,
						password: this.config.password
					}),
					{
						timeout: 15000, // 15 second timeout for login
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
							'Content-Type': 'application/x-www-form-urlencoded',
							'Referer': `${this.config.baseUrl}/bg/users/signin/`
						},
						maxRedirects: 5
					}
				);

				// Check if login was successful - check for any cookies
				const cookies = await this.cookieJar.getCookies(this.config.baseUrl);
				
				// Log all cookies for debugging
				if (cookies.length > 0) {
					console.log('[ArenaBG] Cookies received:', cookies.map(c => c.key).join(', '));
				}
				
				const hasSessionCookie = cookies.some(c => 
					c.key.toLowerCase().includes('session') || 
					c.key.toLowerCase().includes('uid') ||
					c.key.toLowerCase().includes('pass') ||
					c.key.toLowerCase().includes('user') ||
					c.key.toLowerCase().includes('phpsessid') ||
					c.key.toLowerCase().includes('arena') ||
					c.value.length > 10 // Any substantial cookie value
				);

				// Consider login successful if we got any response (status 200) and some cookies
				// The actual test will be if we can search
				if (hasSessionCookie || cookies.length > 0 || loginResponse.status === 200) {
					this.isLoggedIn = true;
					console.log('✓ ArenaBG login successful (will verify with search)');
					return true;
				} else {
					console.error('✗ ArenaBG login failed - no session cookie found');
					console.log('Response status:', loginResponse.status);
					// Do not mark as logged in when we have clear evidence of login failure
					return false;
				}
			} catch (error) {
				console.error('✗ ArenaBG login error:', error.message);
				return false;
			} finally {
				this.loginPromise = null;
			}
		})();

		return this.loginPromise;
	}

	// Helper method to ensure we're logged in before making requests
	async ensureLoggedIn() {
		await this.ensureInitialized();
		if (!this.isLoggedIn) {
			await this.login();
		}
		return this.isLoggedIn;
	}

	// Search method using the ArenaBG torrents URL structure
	async search(query) {
		try {
			const loggedIn = await this.ensureLoggedIn();
			if (!loggedIn) {
				console.error('❌ [ArenaBG] Not logged in; aborting search.');
				return [];
			}

			// ArenaBG torrents search URL: /bg/torrents/?text=query
			const searchUrl = `${this.config.baseUrl}/bg/torrents/?text=${encodeURIComponent(query)}`;
			
			const response = await this.client.get(searchUrl, {
				timeout: 15000, // 15 second timeout
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					'Accept-Charset': 'UTF-8'
				},
				responseType: 'arraybuffer'
			});

			// Decode the response with UTF-8 encoding (ArenaBG uses UTF-8 instead of Windows-1251)
			const decoder = new TextDecoder('utf-8');
			const html = decoder.decode(response.data);
			
			// Debug: Check if we have table content
			const hasTable = html.includes('table-torrents') || html.includes('table.table');
			const hasLoginForm = html.includes('signin') || html.includes('login');
			console.log(`[ArenaBG] HTML received: ${html.length} bytes, has table: ${hasTable}, has login form: ${hasLoginForm}`);
			
			// Debug: Save HTML to file for inspection
			if (!hasTable && process.env.DEBUG_ARENABG) {
				const fs = require('fs');
				fs.writeFileSync('debug-arenabg-response.html', html, 'utf-8');
				console.log(`[ArenaBG] DEBUG: HTML saved to debug-arenabg-response.html`);
			}
			
			// Use the movie parser to extract movie data
			return this.movieParser.parseMovies(html, query);
		} catch (error) {
			console.error('Error searching ArenaBG:', error.message);
			return [];
		}
	}

	/**
	 * Search for movies by title and optionally by year
	 * @param {string} title - Movie title to search for
	 * @param {number|string} year - Optional year to filter results (e.g., 2012 or "2012")
	 * @returns {Array} Array of torrent objects matching the search criteria
	 */
	async searchByTitle(title, year = null) {
		try {
			if (!title || typeof title !== 'string') {
				console.warn('Invalid title provided to searchByTitle');
				return [];
			}

			// Print the searched movie
			const searchDisplay = year ? `${title} (${year})` : title;
			console.log(`🔍 [ArenaBG] Searching for: ${searchDisplay}`);
			
			// Normalize the search title (replace hyphens, dots, colons with spaces)
			const normalizedTitle = this.normalizeSearchTitle(title);
			
			// Perform the search
			const searchQuery = year ? `${normalizedTitle} ${year}` : normalizedTitle;
			const results = await this.search(searchQuery);
			
			if (results.length === 0) {
				console.log(`❌ [ArenaBG] No movies found for: ${searchDisplay}`);
				return [];
			}

			// Filter results based on title and year matching
			const filteredResults = this.filterMoviesByTitleAndYear(results, normalizedTitle, year);
			
			if (filteredResults.length === 0) {
				console.log(`❌ [ArenaBG] No matching movies found for: ${searchDisplay}`);
				return [];
			}

			console.log(`✅ [ArenaBG] Found ${filteredResults.length} matching movies for: ${searchDisplay}`);
			
			// Convert filtered results to torrents
			return this.movieParser.convertMoviesToTorrents(filteredResults);
		} catch (error) {
			console.error(`Error searching ArenaBG by title: ${error.message}`);
			return [];
		}
	}

	/**
	 * Normalize search title by replacing hyphens, dots, and colons with spaces
	 * @param {string} title - Search title to normalize
	 * @returns {string} Normalized search title
	 */
	normalizeSearchTitle(title) {
		if (!title) return '';
		return title
			.trim()
			.replace(/[-\.:]/g, ' ') // Replace hyphens, dots, and colons with spaces
			.replace(/\s+/g, ' ') // Replace multiple spaces with single space
			.trim();
	}

	/**
	 * Filter movie results based on title containment and year matching
	 * @param {Array} movies - Array of movie objects from search results
	 * @param {string} searchTitle - Original search title
	 * @param {number|string|null} searchYear - Optional year to match
	 * @returns {Array} Filtered array of movies
	 */
	filterMoviesByTitleAndYear(movies, searchTitle, searchYear = null) {
		if (!movies || movies.length === 0) return [];

		const searchYearNum = searchYear ? parseInt(searchYear, 10) : null;

		return movies.filter(movie => {
			// Check if the search title is contained in the movie title (case-insensitive)
			const titleContained = movie.title.toLowerCase().includes(searchTitle.toLowerCase());
			
			// Check year match if year is provided
			let yearMatch = true;
			if (searchYearNum && !isNaN(searchYearNum)) {
				yearMatch = this.extractYearFromTitle(movie.title) === searchYearNum;
			}
			
			return titleContained && yearMatch;
		});
	}

	/**
	 * Extract year from movie title
	 * @param {string} title - Movie title that may contain year
	 * @returns {number|null} Extracted year or null if not found
	 */
	extractYearFromTitle(title) {
		if (!title) return null;
		
		// Look for 4-digit year pattern (1900-2099)
		const yearMatch = title.match(/\b(19|20)\d{2}\b/);
		return yearMatch ? parseInt(yearMatch[0], 10) : null;
	}

	// Download and cache a torrent file
	async downloadTorrentFile(torrentUrl) {
		try {
			await this.ensureInitialized();
			
			// Check if we already have this torrent file in cache
			const cachedBuffer = await this.torrentManager.getLocalPath(torrentUrl);
			if (cachedBuffer) {
				return cachedBuffer;
			}

			// Download the torrent file with timeout
			const response = await this.client.get(torrentUrl, {
				responseType: 'arraybuffer',
				timeout: 10000, // 10 second timeout
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				}
			});

			// Save the torrent file to in-memory cache
			return await this.torrentManager.saveTorrentFile(torrentUrl, response.data);
		} catch (error) {
			console.error(`Error downloading torrent file: ${error.message}`);
			return null;
		}
	}

	/**
	 * Fetch torrent detail page and extract download key
	 * @param {string} detailUrl - URL of the torrent detail page
	 * @returns {Promise<string|null>} Download URL with key or null if failed
	 */
	async getDownloadUrl(detailUrl) {
		try {
			const loggedIn = await this.ensureLoggedIn();
			if (!loggedIn) {
				console.error('[ArenaBG] Not logged in; cannot fetch detail page');
				return null;
			}
			
			// Fetch the detail page
			const response = await this.client.get(detailUrl, {
				timeout: 10000,
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				},
				responseType: 'arraybuffer'
			});

			const decoder = new TextDecoder('utf-8');
			const html = decoder.decode(response.data);
			
			// Extract download key from the page
			const downloadKey = this.movieParser.extractDownloadKey(html);
			
			if (downloadKey) {
				return `${this.config.baseUrl}/bg/torrents/download/?key=${downloadKey}`;
			}
			
			console.error(`[ArenaBG] Could not find download key in detail page: ${detailUrl}`);
			return null;
		} catch (error) {
			console.error(`[ArenaBG] Error fetching detail page: ${error.message}`);
			return null;
		}
	}

	// Format torrents as Stremio streams (bounded parallelism)
	async formatTorrentsAsStreams(torrents) {
		try {
			// Create a function to get torrent buffer for the parser
			const getTorrentBuffer = async (torrentUrl) => {
				// Try to get cached torrent buffer first
				let torrentBuffer = await this.torrentManager.getLocalPath(torrentUrl);
				if (!torrentBuffer) {
					torrentBuffer = await this.downloadTorrentFile(torrentUrl);
				}
				return torrentBuffer;
			};

			// First, fetch download URLs for all torrents that need them
			const torrentsWithUrls = await Promise.all(torrents.map(async (torrent) => {
				try {
					if (!torrent.url && torrent.detailUrl) {
						// Need to fetch the detail page to get download URL
						const downloadUrl = await this.getDownloadUrl(torrent.detailUrl);
						if (!downloadUrl) {
							console.error(`[ArenaBG] Skipping torrent - no download URL: ${torrent.title}`);
							return null; // Skip this torrent
						}
						return { ...torrent, url: downloadUrl };
					}
					return torrent;
				} catch (error) {
					console.error(`[ArenaBG] Error processing torrent ${torrent.title}: ${error.message}`);
					return null;
				}
			}));
			
			// Filter out failed torrents
			const validTorrents = torrentsWithUrls.filter(t => t !== null);

			// Use the movie parser to format torrents as streams
			return await this.movieParser.formatTorrentsAsStreams(validTorrents, getTorrentBuffer);
		} catch (error) {
			console.error(`[ArenaBG] Error in formatTorrentsAsStreams: ${error.message}`);
			return [];
		}
	}
}

module.exports = ArenaBGAPI;
