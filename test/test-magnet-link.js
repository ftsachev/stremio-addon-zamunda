require('dotenv').config();
const axios = require('axios');
const tough = require('tough-cookie');
const { TextDecoder } = require('util');

async function testMagnetLink() {
	try {
		console.log('Testing for magnet links on Zamunda.se...\n');
		
		const jar = new tough.CookieJar();
		const { wrapper } = await import('axios-cookiejar-support');
		const client = wrapper(axios.create({ jar }));
		
		// Login
		console.log('Logging in...');
		await client.post(
			'http://zamunda.se/takelogin.php',
			new URLSearchParams({
				username: process.env.ZAMUNDA_SE_USERNAME,
				password: process.env.ZAMUNDA_SE_PASSWORD
			}),
			{
				headers: {
					'User-Agent': 'Mozilla/5.0',
					'Content-Type': 'application/x-www-form-urlencoded'
				}
			}
		);
		
		// Fetch detail page
		console.log('Fetching detail page...');
		const response = await client.get('http://zamunda.se/details.php?id=704374', {
			headers: { 'User-Agent': 'Mozilla/5.0' },
			responseType: 'arraybuffer'
		});
		
		const decoder = new TextDecoder('windows-1251');
		const html = decoder.decode(response.data);
		
		// Check for magnet links
		const hasMagnet = html.includes('magnet:?');
		console.log('\nHas "magnet:?" text:', hasMagnet);
		
		if (hasMagnet) {
			const magnetRegex = /magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"'\s<>]*/g;
			const magnets = html.match(magnetRegex);
			
			if (magnets && magnets.length > 0) {
				console.log('\n✓ Found', magnets.length, 'magnet link(s):');
				magnets.forEach((m, i) => {
					console.log(`  ${i + 1}. ${m.substring(0, 80)}...`);
				});
			} else {
				console.log('\n✗ Found "magnet:" text but failed to extract valid magnet links');
				// Show context
				const magnetIndex = html.indexOf('magnet:');
				if (magnetIndex !== -1) {
					console.log('\nContext around "magnet:":', html.substring(magnetIndex, magnetIndex + 150));
				}
			}
		} else {
			console.log('\n✗ No magnet links found on detail page');
			console.log('   Zamunda.se likely does not provide magnet links');
		}
		
	} catch (error) {
		console.error('Error:', error.message);
	}
}

testMagnetLink();
