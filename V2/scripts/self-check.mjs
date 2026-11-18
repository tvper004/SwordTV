import assert from 'node:assert/strict';
import {
  canonicalizeCatalogPoster,
  findExactTitleMatch,
  formatSeriesSeasonList,
  getCatalogTitleVariants,
  parseM3UChannels,
  streamMatchesEpisode
} from '../src/catalog_sync.js';

assert.deepEqual(formatSeriesSeasonList([]), []);
const seasons = formatSeriesSeasonList([
  { season: 2, number: 2, name: 'Finale' },
  { season: 1, number: 3, name: 'Third' },
  { season: 0, number: 1, name: 'Special' },
  { season: 1, number: 1, name: 'Pilot' },
  { season: 1, number: 1, name: 'Duplicate' },
  { season: 1, name: 'Unnumbered' }
]);
assert.deepEqual(seasons.map(season => [season.seasonNum, season.episodes.map(ep => ep.epNum)]), [[1, [1, 3]], [2, [2]]]);

const matches = [{ name: 'La película equivocada', id: 'tt0000001' }, { name: 'Amélie', id: 'tt0211915' }];
assert.equal(findExactTitleMatch(matches, 'Amelie')?.id, 'tt0211915');
assert.equal(findExactTitleMatch(matches, 'Amelie 2'), null);
assert.deepEqual(getCatalogTitleVariants('El Último Baile (The Last Dance)'), ['El Último Baile (The Last Dance)', 'El Último Baile', 'The Last Dance']);
assert.equal(findExactTitleMatch([{ name: 'The Last Dance', id: 'tt8420184' }], 'El Último Baile (The Last Dance)')?.id, 'tt8420184');
assert.equal(findExactTitleMatch([{ id: 'kitsu-1', attributes: { titles: { ja_jp: '鬼滅の刃' } } }], '鬼滅の刃')?.id, 'kitsu-1');

assert.deepEqual(parseM3UChannels(
  '\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-name="Canal, HD" tvg-logo="images/channel.png" group-title="Noticias",Canal\r\n../live.m3u8\r\n#EXTINF:-1,Bad\r\nfile:///etc/passwd',
  'https://cdn.example.com/lists/channels.m3u'
), [{
  name: 'Canal, HD', logo: 'images/channel.png', group: 'Noticias', streamUrl: 'https://cdn.example.com/live.m3u8'
}]);

assert.equal(streamMatchesEpisode({ title: 'Show.S02E03.1080p' }, { seasonNum: 2, episodeNum: 3 }), true);
assert.equal(streamMatchesEpisode({ title: 'Show.S01E03.1080p' }, { seasonNum: 2, episodeNum: 3 }), false);
assert.equal(streamMatchesEpisode({ title: 'Show.1080p' }, { seasonNum: 2, episodeNum: 3 }), true);

const item = { id: 'tt1234567', poster: 'https://images.metahub.space/poster/medium/tt7654321/img' };
assert.equal(canonicalizeCatalogPoster(item), true);
assert.equal(item.poster, 'https://images.metahub.space/poster/small/tt1234567/img');

console.log('SwordTV self-check passed');
