require('dotenv').config();
const ZamundaMovieParser = require('../src/parsers/zamunda-movie-parser');
const ArenaBGMovieParser = require('../src/parsers/arenabg-movie-parser');
const ZamundaSEMovieParser = require('../src/parsers/zamunda-se-movie-parser');

console.log('='.repeat(80));
console.log('Magnet Link Fallback Test');
console.log('='.repeat(80));

// Mock torrent objects with magnet links
const createMockZamundaTorrent = () => ({
	title: 'Test Movie 2024 1080p\n',
	url: 'https://zamunda.net/download.php/123/test.torrent',
	magnetUrl: 'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Test+Movie',
	size: 'Unknown',
	seeders: 10,
	leechers: 'Unknown',
	hasBulgarianAudio: true
});

const createMockArenaBGTorrent = () => ({
	title: 'Test Movie 2024 720p\n',
	url: 'https://arenabg.com/download/abc/test.torrent',
	magnetUrl: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12&dn=Test',
	detailUrl: 'https://arenabg.com/bg/torrents/abc123/',
	size: '2.5 GB',
	seeders: 5,
	leechers: 2,
	hasBulgarianAudio: false
});

const createMockZamundaSETorrent = () => ({
	title: 'Test Movie SE 480p',
	sources: 'http://zamunda.se/download.php/456/test.torrent',
	magnetUrl: 'magnet:?xt=urn:btih:fedcba0987654321fedcba0987654321fedcba09&dn=SE',
	infoHash: undefined
});

// Mock getTorrentBuffer that always fails (to test fallback)
const failingGetTorrentBuffer = async (url) => {
	console.log(`  [Mock] Simulating torrent download failure for: ${url}`);
	return null; // Simulate failure
};

// Test Zamunda parser fallback
console.log('\n📝 Testing Zamunda Parser - Magnet Fallback');
console.log('-'.repeat(80));
(async () => {
	const zamundaParser = new ZamundaMovieParser('https://zamunda.net');
	const torrents = [createMockZamundaTorrent()];
	
	console.log('Input torrent:', {
		title: torrents[0].title.trim(),
		hasMagnet: !!torrents[0].magnetUrl,
		hasUrl: !!torrents[0].url
	});
	
	const streams = await zamundaParser.formatTorrentsAsStreams(torrents, failingGetTorrentBuffer);
	
	console.log(`\nStreams generated: ${streams.length}`);
	if (streams.length > 0) {
		const stream = streams[0];
		console.log('Stream properties:');
		console.log(`  - name: ${stream.name}`);
		console.log(`  - title: ${stream.title.substring(0, 60)}...`);
		console.log(`  - type: ${stream.type}`);
		console.log(`  - infoHash: ${stream.infoHash || 'N/A'}`);
		console.log(`  - url: ${stream.url ? stream.url.substring(0, 60) + '...' : 'N/A'}`);
		
		// Verify it used magnet link
		if (stream.url && stream.url.startsWith('magnet:')) {
			console.log('\n✅ SUCCESS: Used magnet link as fallback!');
		} else if (stream.infoHash) {
			console.log('\n⚠️  UNEXPECTED: Stream has infoHash (torrent was parsed successfully)');
		} else {
			console.log('\n✗ FAILED: Did not use magnet link as fallback');
		}
	}

	// Test ArenaBG parser fallback
	console.log('\n\n📝 Testing ArenaBG Parser - Magnet Fallback');
	console.log('-'.repeat(80));
	
	const arenabgParser = new ArenaBGMovieParser('https://arenabg.com');
	const arenabgTorrents = [createMockArenaBGTorrent()];
	
	console.log('Input torrent:', {
		title: arenabgTorrents[0].title.trim(),
		hasMagnet: !!arenabgTorrents[0].magnetUrl,
		hasUrl: !!arenabgTorrents[0].url
	});
	
	const arenabgStreams = await arenabgParser.formatTorrentsAsStreams(arenabgTorrents, failingGetTorrentBuffer);
	
	console.log(`\nStreams generated: ${arenabgStreams.length}`);
	if (arenabgStreams.length > 0) {
		const stream = arenabgStreams[0];
		console.log('Stream properties:');
		console.log(`  - name: ${stream.name}`);
		console.log(`  - title: ${stream.title.substring(0, 60)}...`);
		console.log(`  - type: ${stream.type}`);
		console.log(`  - infoHash: ${stream.infoHash || 'N/A'}`);
		console.log(`  - url: ${stream.url ? stream.url.substring(0, 60) + '...' : 'N/A'}`);
		
		// Verify it used magnet link
		if (stream.url && stream.url.startsWith('magnet:')) {
			console.log('\n✅ SUCCESS: Used magnet link as fallback!');
		} else if (stream.infoHash) {
			console.log('\n⚠️  UNEXPECTED: Stream has infoHash (torrent was parsed successfully)');
		} else {
			console.log('\n✗ FAILED: Did not use magnet link as fallback');
		}
	}

	// Test Zamunda.se parser fallback
	console.log('\n\n📝 Testing Zamunda.se Parser - Magnet Fallback');
	console.log('-'.repeat(80));
	
	const zamundaSEParser = new ZamundaSEMovieParser('http://zamunda.se');
	const zamundaSETorrents = [createMockZamundaSETorrent()];
	
	console.log('Input torrent:', {
		title: zamundaSETorrents[0].title,
		hasMagnet: !!zamundaSETorrents[0].magnetUrl,
		hasSources: !!zamundaSETorrents[0].sources
	});
	
	const zamundaSEStreams = await zamundaSEParser.formatTorrentsAsStreams(zamundaSETorrents, failingGetTorrentBuffer);
	
	console.log(`\nStreams generated: ${zamundaSEStreams.length}`);
	if (zamundaSEStreams.length > 0) {
		const stream = zamundaSEStreams[0];
		console.log('Stream properties:');
		console.log(`  - name: ${stream.name}`);
		console.log(`  - title: ${stream.title}`);
		console.log(`  - infoHash: ${stream.infoHash || 'N/A'}`);
		console.log(`  - url: ${stream.url ? stream.url.substring(0, 60) + '...' : 'N/A'}`);
		console.log(`  - sources: ${stream.sources ? JSON.stringify(stream.sources) : 'N/A'}`);
		
		// Verify it used magnet link
		if (stream.url && stream.url.startsWith('magnet:')) {
			console.log('\n✅ SUCCESS: Used magnet link as fallback!');
		} else if (stream.infoHash) {
			console.log('\n⚠️  UNEXPECTED: Stream has infoHash (torrent was parsed successfully)');
		} else {
			console.log('\n✗ FAILED: Did not use magnet link as fallback');
		}
	}

	console.log('\n\n' + '='.repeat(80));
	console.log('✅ Magnet fallback test completed!');
	console.log('='.repeat(80));
})();
