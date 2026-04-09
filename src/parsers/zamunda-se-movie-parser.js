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
							id: movieId
						});
					}
				}
			});

			return movies;
		} catch (error) {
			console.error('Error parsing movies:', error.message);
			return [];
		}
	}

	convertMoviesToTorrents(movies) {
		return movies.map(movie => ({
			title: movie.title,
			url: movie.url,
			sources: movie.torrentUrl
		}));
	}

	async formatTorrentsAsStreams(torrents, getDetailPageHtml) {
		const streams = [];
		
		for (const torrent of torrents) {
			try {
				// Fetch detail page HTML to extract magnet link
				const detailHtml = await getDetailPageHtml(torrent.url);
				
				if (!detailHtml) {
					console.warn(`Failed to fetch detail page for ${torrent.title}`);
					continue;
				}

				// Extract magnet link from HTML
				const magnetRegex = /magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/;
				const magnetMatch = detailHtml.match(magnetRegex);
				
				if (!magnetMatch || !magnetMatch[1]) {
					console.warn(`No magnet link found for ${torrent.title}`);
					continue;
				}

				const infoHash = magnetMatch[1].toLowerCase();
				console.log(`✓ Extracted info hash for ${torrent.title}: ${infoHash}`);

				// Extract quality info from title
				let quality = 'SD';
				const titleUpper = torrent.title.toUpperCase();
				const sourcesUpper = (torrent.sources || '').toUpperCase();
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

				streams.push({
					name: `zamunda.se\n${bgFlag}${quality}`,
					title: torrent.title,
					infoHash: infoHash,
					sources: [`tracker:${this.baseUrl}/announce`]
				});
			} catch (error) {
				console.error(`Error formatting stream for ${torrent.title}:`, error.message);
			}
		}

		return streams;
	}
}

module.exports = ZamundaSEMovieParser;
