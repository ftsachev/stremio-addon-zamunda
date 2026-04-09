const { parse } = require('node-html-parser');
const parseTorrent = require('parse-torrent');

class ZamundaSEMovieParser {
	constructor(baseUrl = 'http://zamunda.se') {
		this.baseUrl = baseUrl;
	}

	normalizeMovieTitle(title) {
		if (!title) return '';
		return title
			.trim()
			.replace(/[-\.:]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	parseMovies(html, query = '') {
		try {
			let root;
			try {
				root = parse(html);
			} catch (parseError) {
				console.error('HTML parsing failed:', parseError.message);
				return [];
			}

			const movies = [];

			// Zamunda.se uses details.php?id= instead of /banan?id=
			const titleCells = root.querySelectorAll('td.colheadd');
			titleCells.forEach((elem) => {
				const link = elem.querySelector('a[href*="details.php?id="]');
				if (link) {
					const title = this.normalizeMovieTitle(link.text);
					const href = link.getAttribute('href');
					
					// Extract ID from details.php?id=702422
					const idMatch = href.match(/id=(\d+)/);
					if (!idMatch) return;
					
					const movieId = idMatch[1];
					
					// Find the download link - look for /download.php/ link
					const parent = elem.parentNode?.parentNode?.parentNode?.parentNode;
					const downloadLink = parent?.querySelector(`a[href*="/download.php/${movieId}/"]`);
					
					if (downloadLink) {
						const downloadHref = downloadLink.getAttribute('href');
						const torrentUrl = downloadHref.startsWith('http') 
							? downloadHref 
							: `${this.baseUrl}${downloadHref}`;
						
						movies.push({
							title: title,
							url: `${this.baseUrl}/details.php?id=${movieId}`,
							torrentUrl: torrentUrl,
							magnetUrl: null,
							id: movieId
						});
					}
				}
			});

			// Extract magnet links
			this.extractMagnetLinks(root, movies, root.toString());

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
				console.log(`[Zamunda.se] Extracted ${magnetLinks.length} magnet links`);
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
					console.log(`[Zamunda.se] Extracted ${index} magnet links (via regex)`);
				}
			}
		} catch (error) {
			console.error('Error extracting magnet links:', error.message);
		}
	}

	convertMoviesToTorrents(movies) {
		return movies.map(movie => ({
			title: movie.title,
			sources: movie.torrentUrl,
			magnetUrl: movie.magnetUrl || null,
			infoHash: undefined
		}));
	}

	async formatTorrentsAsStreams(torrents, getTorrentBuffer) {
		const streams = [];
		
		for (const torrent of torrents) {
			try {
				let torrentBuffer = null;
				let parsedTorrent = null;
				
				// Try to download and parse the torrent
				if (getTorrentBuffer) {
					torrentBuffer = await getTorrentBuffer(torrent.sources);
				}
				
				if (torrentBuffer) {
					try {
						parsedTorrent = parseTorrent(torrentBuffer);
					} catch (parseError) {
						console.warn(`Failed to parse torrent for ${torrent.title}: ${parseError.message}`);
					}
				}

				// Extract quality info from title
				let quality = 'SD';
				const titleUpper = torrent.title.toUpperCase();
				const sourcesUpper = torrent.sources.toUpperCase();
				const combinedText = titleUpper + ' ' + sourcesUpper;
				
				if (combinedText.includes('2160P') || combinedText.includes('4K') || combinedText.includes('UHD')) {
					quality = '4K';
				} else if (combinedText.includes('REMUX')) {
					quality = 'REMUX';
				} else if (combinedText.includes('1080P') || combinedText.includes('1080')) {
					quality = '1080p';
				} else if (combinedText.includes('720P') || combinedText.includes('720')) {
					quality = '720p';
				} else if (combinedText.includes('BDRIP')) {
					quality = 'BDRip';
				} else if (combinedText.includes('BLURAY') || combinedText.includes('BLU-RAY')) {
					quality = 'BluRay';
				}

				// Check for Bulgarian audio/subtitles
				const hasBGAudio = combinedText.includes('BGAUDIO') || combinedText.includes('БГ АУДИО') || combinedText.includes('FLAG_BGAUDIO');
				const hasBGSubs = combinedText.includes('BGSUB') || combinedText.includes('БГ СУБ') || combinedText.includes('FLAG_BGSUB');
				
				let bgFlag = '';
				if (hasBGAudio) {
					bgFlag = '🇧🇬 ';
				} else if (hasBGSubs) {
					bgFlag = '🇧🇬📄 ';
				}

				// If we successfully parsed the torrent, use infoHash
				if (parsedTorrent && parsedTorrent.infoHash) {
					streams.push({
						name: `zamunda.se\n${bgFlag}${quality}`,
						title: torrent.title,
						infoHash: parsedTorrent.infoHash.toLowerCase(),
						sources: [`tracker:${this.baseUrl}/announce`]
					});
				} else {
					// Fallback 1: Use magnet link if available
					if (torrent.magnetUrl) {
						console.log(`[Zamunda.se] Using magnet link as fallback for: ${torrent.title}`);
						streams.push({
							name: `zamunda.se\n${bgFlag}${quality}`,
							title: torrent.title,
							url: torrent.magnetUrl
						});
					} else {
						// Fallback 2: Use torrent URL
						console.warn(`[Zamunda.se] No infoHash or magnet for ${torrent.title}, using torrent URL`);
						streams.push({
							name: `zamunda.se\n${bgFlag}${quality}`,
							title: torrent.title,
							url: torrent.sources
						});
					}
				}
			} catch (error) {
				console.error(`Error formatting stream for ${torrent.title}:`, error.message);
				
				// On error, try magnet link first
				if (torrent.magnetUrl) {
					console.log(`[Zamunda.se] Using magnet link after error for: ${torrent.title}`);
					streams.push({
						name: `zamunda.se\nSD`,
						title: torrent.title,
						url: torrent.magnetUrl
					});
				}
			}
		}

		return streams;
	}
}

module.exports = ZamundaSEMovieParser;
