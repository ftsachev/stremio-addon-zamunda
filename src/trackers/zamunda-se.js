const axios = require('axios');
const tough = require('tough-cookie');
const { TextDecoder } = require('util');
const TorrentFileManager = require('../utils/torrentFileManager.js');
const ZamundaSEMovieParser = require('../parsers/zamunda-se-movie-parser.js');

class ZamundaSEAPI {
	constructor(config) {
		this.config = {
			username: config.username,
			password: config.password,
			baseUrl: 'http://zamunda.se'
		};
		
		// Initialize async components
		this.cookieJar = new tough.CookieJar();
		this.client = null; // Will be initialized in init()
		this.isLoggedIn = false;
		this.loginPromise = null;
		this.torrentManager = new TorrentFileManager();
		this.movieParser = new ZamundaSEMovieParser(this.config.baseUrl);
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
			throw new Error(`Failed to initialize ZamundaSEAPI: ${error.message}`);
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
				await this.client.get(`${this.config.baseUrl}/takelogin.php`, {
					timeout: 10000, // 10 second timeout
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
					}
				});

				// Perform login
				const loginResponse = await this.client.post(
					`${this.config.baseUrl}/takelogin.php`,
					new URLSearchParams({
						username: this.config.username,
						password: this.config.password,
						returnto: '/'
					}),
					{
						timeout: 15000, // 15 second timeout for login
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
							'Content-Type': 'application/x-www-form-urlencoded',
							'Referer': `${this.config.baseUrl}/login.php`
						},
						maxRedirects: 5
					}
				);

				// Check if login was successful
				const cookies = await this.cookieJar.getCookies(this.config.baseUrl);
				const hasSessionCookie = cookies.some(c => 
					c.key.toLowerCase().includes('session') || 
					c.key.toLowerCase().includes('uid') ||
					c.key.toLowerCase().includes('pass')
				);

				if (hasSessionCookie) {
					this.isLoggedIn = true;
					return true;
				} else {
					console.error('✗ Zamunda.se Login failed - no session cookie found');
					console.log('Response status:', loginResponse.status);
					return false;
				}
			} catch (error) {
				console.error('✗ Zamunda.se Login error:', error.message);
				return false;
			} finally {
				this.loginPromise = null;
			}
		})();

		return this.loginPromise;
	}

// Login function
	// Helper method to ensure we're logged in before making requests
	async ensureLoggedIn() {
		await this.ensureInitialized();
		if (!this.isLoggedIn) {
			await this.login();
		}
		return this.isLoggedIn;
	}

	// Search method
	async search(query) {
		try {
			await this.ensureLoggedIn();

			const searchUrl = `${this.config.baseUrl}/catalogue.php?search=${encodeURIComponent(query).replace(/%20/g, '+')}&catalog=movies`;
			

			const response = await this.client.get(searchUrl, {
				timeout: 15000, // 15 second timeout
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					'Accept-Charset': 'UTF-8'
				},
				responseType: 'arraybuffer'
			});

				// Decode the response with Windows-1251 (Cyrillic) encoding
				const decoder = new TextDecoder('windows-1251');
				const html = decoder.decode(response.data);
				
				// Use the movie parser to extract movie data
				return this.movieParser.parseMovies(html, query);
		} catch (error) {
			console.error('Error searching Zamunda.se:', error.message);
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
			console.log(`🔍 [Zamunda.se] Searching for: ${searchDisplay}`);
			
			// Normalize the search title (replace hyphens, dots, colons with spaces)
			const normalizedTitle = this.normalizeSearchTitle(title);
			
			// Perform the search
			const searchQuery = year ? `${normalizedTitle} ${year}` : normalizedTitle;
			const results = await this.search(searchQuery);
			
			if (results.length === 0) {
				console.log(`❌ [Zamunda.se] No movies found for: ${searchDisplay}`);
				return [];
			}


			// Filter results based on title and year matching
			const filteredResults = this.filterMoviesByTitleAndYear(results, normalizedTitle, year);
			
			if (filteredResults.length === 0) {
				console.log(`❌ [Zamunda.se] No matching movies found for: ${searchDisplay}`);
				return [];
			}

			console.log(`✅ [Zamunda.se] Found ${filteredResults.length} matching movies for: ${searchDisplay}`);
			
			// Convert filtered results to torrents
			return this.movieParser.convertMoviesToTorrents(filteredResults);
		} catch (error) {
			throw new Error(`Error searching by title: ${error.message}`);
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
			await this.login(); // Ensure we're logged in
			
			if (!this.isLoggedIn) {
				console.error(`Cannot download torrent - not logged in to Zamunda.se`);
				return null;
			}
			
			// Check if we already have this torrent file in cache
			const cachedBuffer = await this.torrentManager.getLocalPath(torrentUrl);
			if (cachedBuffer) {
				console.log(`Using cached torrent for ${torrentUrl}`);
				return cachedBuffer;
			}

			console.log(`Downloading torrent from ${torrentUrl}`);
			
			// Download the torrent file with timeout and authentication
			const response = await this.client.get(torrentUrl, {
				responseType: 'arraybuffer',
				timeout: 10000, // 10 second timeout
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				}
			});

			console.log(`Download response status: ${response.status}, size: ${response.data?.byteLength || 0} bytes`);

			// Validate response
			if (!response.data || response.data.byteLength === 0) {
				console.error(`Empty response when downloading torrent from ${torrentUrl}`);
				console.error(`Response status: ${response.status}, headers:`, response.headers);
				return null;
			}

			// Save the torrent file to in-memory cache
			const savedBuffer = await this.torrentManager.saveTorrentFile(torrentUrl, response.data);
			console.log(`Successfully cached torrent (${savedBuffer.byteLength} bytes)`);
			return savedBuffer;
		} catch (error) {
			console.error(`Error downloading torrent file from ${torrentUrl}:`, error.message);
			if (error.response) {
				console.error(`Response status: ${error.response.status}`);
				console.error(`Response headers:`, error.response.headers);
			}
			// Return null instead of throwing to allow graceful degradation
			return null;
		}
	}

	// Format torrents as Stremio streams (bounded parallelism)
	async formatTorrentsAsStreams(torrents) {
		// Create a function to get detail page HTML for the parser
		const getDetailPageHtml = async (detailUrl) => {
			try {
				await this.ensureInitialized();
				await this.login();
				
				if (!this.isLoggedIn) {
					console.error(`Cannot fetch detail page - not logged in to Zamunda.se`);
					return null;
				}
				
				console.log(`Fetching detail page: ${detailUrl}`);
				
				const response = await this.client.get(detailUrl, {
					timeout: 10000,
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
					},
					responseType: 'arraybuffer'
				});
				
				// Decode Windows-1251
				const decoder = new TextDecoder('windows-1251');
				const html = decoder.decode(response.data);
				
				return html;
			} catch (error) {
				console.error(`Error fetching detail page ${detailUrl}:`, error.message);
				return null;
			}
		};

		// Use the movie parser to format torrents as streams
		return await this.movieParser.formatTorrentsAsStreams(torrents, getDetailPageHtml);
	}
}

module.exports = ZamundaSEAPI;
