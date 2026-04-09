require('dotenv').config();
const ZamundaMovieParser = require('../src/parsers/zamunda-movie-parser');
const ArenaBGMovieParser = require('../src/parsers/arenabg-movie-parser');
const ZamundaSEMovieParser = require('../src/parsers/zamunda-se-movie-parser');

console.log('='.repeat(80));
console.log('Magnet Link Extraction Test');
console.log('='.repeat(80));

// Mock HTML with magnet links for testing
const createMockZamundaHTML = () => {
	return `
		<html>
		<body>
			<table>
				<tr>
					<td class="colheadd">
						<a href="/banan?id=123">Test Movie 2024 1080p</a>
					</td>
				</tr>
				<tr>
					<td>
						<a href="magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Test+Movie">Magnet</a>
					</td>
					<td>
						<a href="/download.php/123/test.torrent">Download</a>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`;
};

const createMockArenaBGHTML = () => {
	return `
		<html>
		<body>
			<table class="table-torrents">
				<tbody>
					<tr>
						<td class="filename">
							<a href="/bg/torrents/abc123/" class="title">Test Movie 2024 1080p</a>
						</td>
						<td class="seeders">10</td>
						<td class="leechers">2</td>
					</tr>
					<tr>
						<td>
							<a href="magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12&dn=Test">Magnet</a>
						</td>
					</tr>
				</tbody>
			</table>
		</body>
		</html>
	`;
};

const createMockZamundaSEHTML = () => {
	return `
		<html>
		<body>
			<table>
				<tr>
					<td class="colheadd">
						<a href="details.php?id=456">Test Movie SE 720p</a>
					</td>
				</tr>
				<tr>
					<td>
						<a href="/download.php/456/test.torrent">Download</a>
					</td>
					<td>
						<a href="magnet:?xt=urn:btih:fedcba0987654321fedcba0987654321fedcba09&dn=SE">Magnet</a>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`;
};

// Test Zamunda parser
console.log('\n📝 Testing Zamunda Movie Parser');
console.log('-'.repeat(80));
const zamundaParser = new ZamundaMovieParser('https://zamunda.net');
const zamundaHTML = createMockZamundaHTML();
const zamundaMovies = zamundaParser.parseMovies(zamundaHTML, 'test');

console.log(`Movies parsed: ${zamundaMovies.length}`);
if (zamundaMovies.length > 0) {
	const movie = zamundaMovies[0];
	console.log(`Title: ${movie.title}`);
	console.log(`Torrent URL: ${movie.torrentUrl ? '✓ Found' : '✗ Missing'}`);
	console.log(`Magnet URL: ${movie.magnetUrl ? '✓ Found' : '✗ Missing'}`);
	if (movie.magnetUrl) {
		console.log(`  → ${movie.magnetUrl.substring(0, 80)}...`);
	}
	
	// Test conversion to torrents
	const torrents = zamundaParser.convertMoviesToTorrents(zamundaMovies);
	console.log(`\nTorrents converted: ${torrents.length}`);
	if (torrents.length > 0) {
		console.log(`Torrent has magnetUrl: ${torrents[0].magnetUrl ? '✓ Yes' : '✗ No'}`);
	}
}

// Test ArenaBG parser
console.log('\n\n📝 Testing ArenaBG Movie Parser');
console.log('-'.repeat(80));
const arenabgParser = new ArenaBGMovieParser('https://arenabg.com');
const arenabgHTML = createMockArenaBGHTML();
const arenabgMovies = arenabgParser.parseMovies(arenabgHTML, 'test');

console.log(`Movies parsed: ${arenabgMovies.length}`);
if (arenabgMovies.length > 0) {
	const movie = arenabgMovies[0];
	console.log(`Title: ${movie.title}`);
	console.log(`Detail URL: ${movie.detailUrl ? '✓ Found' : '✗ Missing'}`);
	console.log(`Magnet URL: ${movie.magnetUrl ? '✓ Found' : '✗ Missing'}`);
	if (movie.magnetUrl) {
		console.log(`  → ${movie.magnetUrl.substring(0, 80)}...`);
	}
	
	// Test conversion to torrents
	const torrents = arenabgParser.convertMoviesToTorrents(arenabgMovies);
	console.log(`\nTorrents converted: ${torrents.length}`);
	if (torrents.length > 0) {
		console.log(`Torrent has magnetUrl: ${torrents[0].magnetUrl ? '✓ Yes' : '✗ No'}`);
	}
}

// Test Zamunda.se parser
console.log('\n\n📝 Testing Zamunda.se Movie Parser');
console.log('-'.repeat(80));
const zamundaSEParser = new ZamundaSEMovieParser('http://zamunda.se');
const zamundaSEHTML = createMockZamundaSEHTML();
const zamundaSEMovies = zamundaSEParser.parseMovies(zamundaSEHTML, 'test');

console.log(`Movies parsed: ${zamundaSEMovies.length}`);
if (zamundaSEMovies.length > 0) {
	const movie = zamundaSEMovies[0];
	console.log(`Title: ${movie.title}`);
	console.log(`Torrent URL: ${movie.torrentUrl ? '✓ Found' : '✗ Missing'}`);
	console.log(`Magnet URL: ${movie.magnetUrl ? '✓ Found' : '✗ Missing'}`);
	if (movie.magnetUrl) {
		console.log(`  → ${movie.magnetUrl.substring(0, 80)}...`);
	}
	
	// Test conversion to torrents
	const torrents = zamundaSEParser.convertMoviesToTorrents(zamundaSEMovies);
	console.log(`\nTorrents converted: ${torrents.length}`);
	if (torrents.length > 0) {
		console.log(`Torrent has magnetUrl: ${torrents[0].magnetUrl ? '✓ Yes' : '✗ No'}`);
	}
}

// Summary
console.log('\n\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

let allPassed = true;

if (zamundaMovies.length === 0 || !zamundaMovies[0].magnetUrl) {
	console.log('✗ Zamunda parser failed to extract magnet link');
	allPassed = false;
} else {
	console.log('✓ Zamunda parser successfully extracted magnet link');
}

if (arenabgMovies.length === 0 || !arenabgMovies[0].magnetUrl) {
	console.log('✗ ArenaBG parser failed to extract magnet link');
	allPassed = false;
} else {
	console.log('✓ ArenaBG parser successfully extracted magnet link');
}

if (zamundaSEMovies.length === 0 || !zamundaSEMovies[0].magnetUrl) {
	console.log('✗ Zamunda.se parser failed to extract magnet link');
	allPassed = false;
} else {
	console.log('✓ Zamunda.se parser successfully extracted magnet link');
}

console.log('='.repeat(80));
if (allPassed) {
	console.log('✅ All tests passed!');
	process.exit(0);
} else {
	console.log('❌ Some tests failed!');
	process.exit(1);
}
