const { parse } = require('node-html-parser');
const parseTorrent = require('parse-torrent');

class ZamundaMovieParser {
	constructor(baseUrl = 'https://zamunda.net') {
		this.baseUrl = baseUrl;
	}

	/**
	 * Parse HTML content to extract movie data
	 * @param {string} html - HTML content to parse
	 * @param {string} query - Search query for fallback parsing
	 * @returns {Array} Array of movie objects
	 */
	/**
	 * Normalize movie title by replacing hyphens and dots with spaces
	 * @param {string} title - Raw title from HTML
	 * @returns {string} Normalized title
	 */
	normalizeMovieTitle(title) {
		if (!title) return '';
		return title
			.trim()
			.replace(/[-\.:]/g, ' ') // Replace hyphens, dots, and colons with spaces
			.replace(/\s+/g, ' ') // Replace multiple spaces with single space
			.trim();
	}

	parseMovies(html, query = '') {
		try {
			// Parse HTML with error handling
			let root;
			try {
				root = parse(html);
			} catch (parseError) {
				console.error('HTML parsing failed, using regex fallback:', parseError.message);
				// Fallback to regex parsing if HTML parser fails
				return this.parseWithRegex(html, query);
			}

			const movies = [];

			// First collect movie titles and IDs
			const titleCells = root.querySelectorAll('td.colheadd');
			titleCells.forEach((elem) => {
				const link = elem.querySelector('a[href*="/banan?id="]');
				if (link) {
					const title = this.normalizeMovieTitle(link.text);
					const href = link.getAttribute('href');
					
					if (title && href) {
						const match = href.match(/id=(\d+)/);
						const movieId = match ? match[1] : null;
						
						if (movieId) {
							movies.push({
								id: movieId,
								title: title,
								torrentUrl: null,
								magnetUrl: null
							});
						}
					}
				}
			});

			// Then find and add torrent links
			const torrentLinks = root.querySelectorAll('a[href*="/download.php/"], a[href*=".torrent"]');
			torrentLinks.forEach((elem, i) => {
				if (i < movies.length) {
					const torrentLink = elem.getAttribute('href');
					if (torrentLink) {
						movies[i].torrentUrl = torrentLink.startsWith('http') ? 
							torrentLink : `${this.baseUrl}${torrentLink}`;
					}
				}
			});

			// Extract magnet links
			this.extractMagnetLinks(root, movies, html);

			// Find and add seeders count - Multiple approaches for robustness
			this.parseSeeders(root, movies, html);

			// Detect flags (Bulgarian audio, subtitles, 3D, etc.)
			this.detectFlags(root, movies);

			// Parse movie sizes
			this.parseMovieSizes(root, movies);

			return movies;
		} catch (error) {
			console.error('Error parsing movies:', error.message);
			return [];
		}
	}

	/**
	 * Extract magnet links from HTML and associate them with movies
	 * @param {Object} root - Parsed HTML root element
	 * @param {Array} movies - Array of movie objects to update
	 * @param {string} html - Raw HTML string
	 */
	extractMagnetLinks(root, movies, html) {
		try {
			// Look for magnet links in the HTML
			// Common patterns: <a href="magnet:?xt=urn:btih:...">
			const magnetLinks = root.querySelectorAll('a[href^="magnet:"]');
			
			if (magnetLinks.length > 0) {
				magnetLinks.forEach((elem, i) => {
					if (i < movies.length) {
						const magnetHref = elem.getAttribute('href');
						if (magnetHref && magnetHref.startsWith('magnet:')) {
							movies[i].magnetUrl = magnetHref;
						}
					}
				});
				console.log(`[Zamunda] Extracted ${magnetLinks.length} magnet links`);
			} else {
				// Fallback: regex-based extraction if DOM parsing doesn't find magnet links
				const magnetRegex = /href=["'](magnet:\?xt=urn:btih:[^"']+)["']/gi;
				let match;
				let index = 0;
				
				while ((match = magnetRegex.exec(html)) !== null && index < movies.length) {
					movies[index].magnetUrl = match[1];
					index++;
				}
				
				if (index > 0) {
					console.log(`[Zamunda] Extracted ${index} magnet links (via regex)`);
				}
			}
		} catch (error) {
			console.error('Error extracting magnet links:', error.message);
		}
	}

	/**
	 * Detect flags (Bulgarian audio, subtitles, 3D, etc.) for movies
	 * @param {Object} root - Parsed HTML root element
	 * @param {Array} movies - Array of movie objects to update
	 */
	detectFlags(root, movies) {
		try {
			// Use regex to find flag patterns and match them with movie IDs
			// The pattern: flags appear before banan?id= links in the HTML
			const flagPattern = /<img[^>]*src=['"][^'"]*flag_([^'"]*)['"][^>]*>.*?<a[^>]*href=['"][^'"]*\/banan\?id=(\d+)/g;
			
			const movieFlags = [];
			let match;
			
			while ((match = flagPattern.exec(root.toString())) !== null) {
				const flagType = match[1]; // bgsub, bgaudio, 3d, etc.
				const movieId = match[2];
				
				const movieIndex = movies.findIndex(movie => movie.id === movieId);
				if (movieIndex !== -1) {
					if (!movieFlags[movieIndex]) {
						movieFlags[movieIndex] = [];
					}
					
					// Map flag types to our internal flags
					if (flagType.includes('bgaudio')) {
						movieFlags[movieIndex].push('bg_audio');
					}
					if (flagType.includes('bgsub')) {
						movieFlags[movieIndex].push('bg_subtitles');
					}
					if (flagType.includes('3d')) {
						movieFlags[movieIndex].push('3d');
					}
				}
			}
			
			// Apply flags to movies
			movieFlags.forEach((flags, index) => {
				if (flags && flags.length > 0) {
					movies[index].flags = flags;
					movies[index].hasBulgarianAudio = flags.includes('bg_audio');
					movies[index].hasBulgarianSubtitles = flags.includes('bg_subtitles');
					movies[index].is3D = flags.includes('3d');
				}
			});
		} catch (error) {
			console.error('Error detecting flags:', error.message);
		}
	}

	/**
	 * Parse movie sizes from HTML
	 * @param {Object} root - Parsed HTML root element
	 * @param {Array} movies - Array of movie objects to update
	 */
	parseMovieSizes(root, movies) {
		try {
			// Parse sizes and movie IDs separately, then match by order
			const htmlString = root.toString();
			
			// Find all sizes
			const sizePattern = /<td><font color=red>([\d.]+ (?:GB|MB))<\/font><\/td>/g;
			const sizes = [];
			let sizeMatch;
			
			while ((sizeMatch = sizePattern.exec(htmlString)) !== null) {
				sizes.push(sizeMatch[1]);
			}
			
			// Find all movie IDs in the same order as they appear in movies array
			const movieIds = movies.map(movie => movie.id);
			
			// Match sizes with movies by order
			sizes.forEach((size, index) => {
				if (index < movies.length) {
					movies[index].size = size;
				}
			});
			
		} catch (error) {
			console.error('Error parsing movie sizes:', error.message);
		}
	}

	/**
	 * Fallback regex parsing method when HTML parsing fails
	 * @param {string} html - HTML content to parse
	 * @param {string} query - Search query
	 * @returns {Array} Array of movie objects
	 */
	parseWithRegex(html, query) {
		const movies = [];
		try {
			// Simple regex patterns to extract movie data
			const titleRegex = /<a[^>]*href="[^"]*\/banan\?id=(\d+)"[^>]*>([^<]+)<\/a>/gi;
			const torrentRegex = /<a[^>]*href="([^"]*(?:download\.php|\.torrent)[^"]*)"[^>]*>/gi;
			
			let match;
			while ((match = titleRegex.exec(html)) !== null) {
				movies.push({
					id: match[1],
					title: this.normalizeMovieTitle(match[2]),
					torrentUrl: null,
					seeders: 0
				});
			}
			
			// Try to match torrent links with movies
			let torrentMatch;
			let movieIndex = 0;
			while ((torrentMatch = torrentRegex.exec(html)) !== null && movieIndex < movies.length) {
				const torrentUrl = torrentMatch[1];
				if (torrentUrl) {
					movies[movieIndex].torrentUrl = torrentUrl.startsWith('http') ? 
						torrentUrl : `${this.baseUrl}${torrentUrl}`;
					movieIndex++;
				}
			}
			
			console.log(`Regex fallback found ${movies.length} movies`);
			return movies;
		} catch (error) {
			console.error('Regex parsing also failed:', error.message);
			return [];
		}
	}

	/**
	 * Parse seeders using multiple approaches for robustness
	 * @param {Object} root - Parsed HTML root element
	 * @param {Array} movies - Array of movie objects
	 * @param {string} html - Raw HTML string
	 */
	parseSeeders(root, movies, html) {
		try {
			// Approach 1: DOM-based parsing
			const seederCells = root.querySelectorAll('td.tddownloaded center font a');
			seederCells.forEach((elem, i) => {
				if (i < movies.length && movies[i].seeders === undefined) {
					const seedersElement = elem.querySelector('b');
					if (seedersElement) {
						const seeders = seedersElement.text.trim();
						if (seeders) {
							movies[i].seeders = parseInt(seeders, 10) || 0;
						}
					}
				}
			});

			// Approach 2: Alternative DOM selectors
			if (movies.some(movie => movie.seeders === undefined)) {
				const altSeederCells = root.querySelectorAll('td.tddownloaded font a b');
				altSeederCells.forEach((elem, i) => {
					if (i < movies.length && movies[i].seeders === undefined) {
						const seeders = elem.text.trim();
						if (seeders) {
							movies[i].seeders = parseInt(seeders, 10) || 0;
						}
					}
				});
			}

			// Approach 3: Regex-based parsing as fallback
			if (movies.some(movie => movie.seeders === undefined)) {
				const seederPattern = /<b>(\d+)<\/b>.*?<b>(\d+)<\/b>/g;
				let match;
				let movieIndex = 0;
				
				while ((match = seederPattern.exec(html)) !== null && movieIndex < movies.length) {
					if (movies[movieIndex].seeders === undefined) {
						movies[movieIndex].seeders = parseInt(match[1], 10) || 0;
						movies[movieIndex].leechers = parseInt(match[2], 10) || 0;
					}
					movieIndex++;
				}
			}

			// Approach 4: More flexible regex patterns
			if (movies.some(movie => movie.seeders === undefined)) {
				const flexiblePattern = /<b[^>]*>(\d+)<\/b>.*?<b[^>]*>(\d+)<\/b>/g;
				let match;
				let movieIndex = 0;
				
				while ((match = flexiblePattern.exec(html)) !== null && movieIndex < movies.length) {
					if (movies[movieIndex].seeders === undefined) {
						movies[movieIndex].seeders = parseInt(match[1], 10) || 0;
						movies[movieIndex].leechers = parseInt(match[2], 10) || 0;
					}
					movieIndex++;
				}
			}

			// Set default values for any remaining undefined seeders
			movies.forEach(movie => {
				if (movie.seeders === undefined) {
					movie.seeders = 0;
					movie.leechers = 0;
				}
			});

		} catch (error) {
			console.error('Error parsing seeders:', error.message);
			// Set default values if parsing fails
			movies.forEach(movie => {
				if (movie.seeders === undefined) {
					movie.seeders = 0;
					movie.leechers = 0;
				}
			});
		}
	}

	/**
	 * Convert movie objects to torrent format
	 * @param {Array} movies - Array of movie objects
	 * @returns {Array} Array of torrent objects
	 */
	convertMoviesToTorrents(movies) {
		return movies.map(movie => ({
			title: `${movie.title}\n`,
			url: movie.torrentUrl,
			magnetUrl: movie.magnetUrl || null,
			size: 'Unknown',
			seeders: movie.seeders,
			leechers: 'Unknown',
			hasBulgarianAudio: movie.hasBulgarianAudio || false
		}));
	}

	/**
	 * Extract resolution from torrent URL or title
	 * @param {string} text - Text to extract resolution from
	 * @returns {string} Resolution string
	 */
	extractResolution(text) {
		if (!text) return 'Unknown';
		
		const textLower = text.toLowerCase();
		
		// Check for 3D content first
		const is3D = textLower.includes('3d') || textLower.includes('halfou') || textLower.includes('hsbs');
		
		// Single comprehensive regex to find any resolution
		const resolutionMatch = text.match(/\b(8K|2160p|4K|UHD|1440p|2K|1080p|FHD|FullHD|Full HD|720p|HD|576p|480p|SD|bluray|blu-ray|blu ray|brrip|bdrip|webrip|web-rip|web\.rip|dvd|pal|ntsc|xvid|divx)\b/i);
		
		if (resolutionMatch) {
			const match = resolutionMatch[1].toLowerCase();
			
			// Map the match to standard resolution
			if (match.match(/^(8k|2160p|4k|uhd)$/)) return is3D ? '4K(3D)' : '4K';
			if (match.match(/^(1440p|2k)$/)) return is3D ? '1440p(3D)' : '1440p';
			if (match.match(/^(1080p|fhd|fullhd|full hd)$/)) return is3D ? '1080p(3D)' : '1080p';
			if (match.match(/^(720p|hd)$/)) return is3D ? '720p(3D)' : '720p';
			if (match.match(/^576p$/)) return is3D ? '576p(3D)' : '576p';
			if (match.match(/^(480p|sd)$/)) return is3D ? '480p(3D)' : '480p';
			if (match.match(/^(bluray|blu-ray|blu ray)$/)) return is3D ? '1080p(3D)' : '1080p';
			if (match.match(/^(brrip|bdrip|webrip|web-rip|web\.rip)$/)) return is3D ? '720p(3D)' : '720p';
			if (match.match(/^(dvd|pal|ntsc|xvid|divx)$/)) return is3D ? '480p(3D)' : '480p';
		}
		
		// If 3D but no resolution found
		if (is3D) {
			return '3D';
		}
		
		return 'Unknown';
	}

	/**
	 * Parse torrent buffer to extract metadata
	 * @param {Buffer} torrentBuffer - Torrent file buffer
	 * @returns {Object} Parsed torrent metadata
	 */
	parseTorrentMetadata(torrentBuffer) {
		try {
			const parsedTorrent = parseTorrent(torrentBuffer);
			const sizeGb = parsedTorrent.length ? 
				`${(parsedTorrent.length / (1024*1024*1024)).toFixed(2)} GB` : 
				'Unknown';

			return {
				infoHash: parsedTorrent.infoHash,
				size: sizeGb,
				length: parsedTorrent.length
			};
		} catch (parseError) {
			console.error(`Error parsing torrent buffer: ${parseError.message}`);
			return null;
		}
	}

	/**
	 * Format torrents as Stremio streams with bounded parallelism
	 * @param {Array} torrents - Array of torrent objects
	 * @param {Function} getTorrentBuffer - Function to get torrent buffer
	 * @returns {Promise<Array>} Array of formatted stream objects
	 */
	async formatTorrentsAsStreams(torrents, getTorrentBuffer) {
		const limit = (concurrency) => {
			let active = 0; 
			const queue = [];
			const next = () => {
				if (active >= concurrency || queue.length === 0) return;
				active++;
				const { fn, resolve, reject } = queue.shift();
				fn().then(resolve, reject).finally(() => { active--; next(); });
			};
			return (fn) => new Promise((resolve, reject) => { 
				queue.push({ fn, resolve, reject }); 
				process.nextTick(next); 
			});
		};

		const withLimit = limit(3);

		const tasks = torrents.map((torrent) => withLimit(async () => {
			try {
				// Prefer resolution from URL (torrent name)
				const resolution = this.extractResolution(torrent.url);

				// Try to get torrent buffer
				let torrentBuffer = null;
				if (getTorrentBuffer) {
					torrentBuffer = await getTorrentBuffer(torrent.url);
				}

				// If we have a torrent buffer, try to parse it
				if (torrentBuffer) {
					const metadata = this.parseTorrentMetadata(torrentBuffer);
					if (metadata) {
						return {
							name: `zamunda\n${resolution}`,
							title: `${torrent.title}${torrent.hasBulgarianAudio ? ' 🇧🇬' : ''} 👤${torrent.seeders || 'Unknown'} 💾 ${metadata.size}`,
							infoHash: metadata.infoHash,
							type: 'stream'
						};
					}
				}

				// Fallback 1: Use magnet link if available
				if (torrent.magnetUrl) {
					console.log(`[Zamunda] Using magnet link as fallback for: ${torrent.title.trim()}`);
					return {
						name: `zamunda\n${resolution}`,
						title: `${torrent.title}${torrent.hasBulgarianAudio ? ' 🇧🇬' : ''} 👤${torrent.seeders || 'Unknown'}`,
						url: torrent.magnetUrl,
						type: 'movie'
					};
				}

				// Fallback 2: return basic stream info with torrent URL
				return {
					name: `zamunda\n${resolution}`,
					title: `${torrent.title}${torrent.hasBulgarianAudio ? ' 🇧🇬' : ''} 👤${torrent.seeders || 'Unknown'}`,
					url: torrent.url,
					type: 'movie'
				};
			} catch (error) {
				console.error(`Error processing torrent: ${error.message}`);
				const resolution = this.extractResolution(torrent.title);
				
				// On error, try magnet link first
				if (torrent.magnetUrl) {
					console.log(`[Zamunda] Using magnet link after error for: ${torrent.title.trim()}`);
					return {
						name: `zamunda\r\n${resolution}`,
						title: `${torrent.title}\r\n${torrent.hasBulgarianAudio ? ' 🇧🇬' : ''}`,
						url: torrent.magnetUrl,
						type: 'movie'
					};
				}
				
				// Final fallback to torrent URL
				return {
					name: `zamunda\r\n${resolution}`,
					title: `${torrent.title}\r\n${torrent.hasBulgarianAudio ? ' 🇧🇬' : ''}`,
					url: torrent.url,
					type: 'movie'
				};
			}
		}));

		const results = await Promise.all(tasks);
		return results;
	}
}

module.exports = ZamundaMovieParser;
