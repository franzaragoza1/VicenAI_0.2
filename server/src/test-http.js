const http = require('http');

http.get('http://localhost:8081/api/latest', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log('✅ HTTP /api/latest response:');
    console.log(`  Lap: ${json.CompletedLaps}, Speed: ${json.Speed}, Damage: ${json.CarDamagePercent}%`);
    console.log(`  Gap Ahead: ${json.GapToPlayerAhead}s, Gap Behind: ${json.GapToPlayerBehind}s`);
    console.log(`  Timestamp: ${new Date(json.timestamp).toISOString()}`);
  });
}).on('error', err => console.error('❌ Error:', err.message));
