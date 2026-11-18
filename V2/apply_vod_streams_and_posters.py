import json, re, os

# 1. Load verified working streams
with open('/tmp/all_verified_working_streams.json') as f:
    streams = json.load(f)

# Deduplicate
seen = set()
unique_streams = []
for name, url, group in streams:
    if url not in seen and not any(bad in url for bad in ['bipbop', 'oceans.mp4', 'sintel', 'tears-of-steel', 'akamaized.net/hls/live/2000341']):
        seen.add(url)
        unique_streams.append((name, url, group))

print(f"Total unique verified streams: {len(unique_streams)}")

movies_streams = [s[1] for s in unique_streams if any(k in s[0].lower() for k in ['cine', 'pelicul', 'film', 'cinema', 'movie', 'amc', 'cinemax', 'paramount', 'warner', 'action', 'thriller', 'terror'])]
series_streams = [s[1] for s in unique_streams if any(k in s[0].lower() for k in ['serie', 'series', 'criminal', 'detective', 'comedia', 'sitcom', 'drama', 'forens', 'midsomer', 'catfish', 'archivos'])]
anime_streams = [s[1] for s in unique_streams if any(k in s[0].lower() for k in ['anime', 'conan', 'inuyasha', 'naruto', 'sailor', 'yugioh', 'yu-gi-oh', 'dragon ball', 'hidive', 'crunchy', 'otaku', 'zodiaco', 'lupin', 'inazuma'])]
novelas_streams = [s[1] for s in unique_streams if any(k in s[0].lower() for k in ['novela', 'corazon', 'pasiones', 'drama', 'telenovela', 'coreano', 'curro', 'ana y los 7', 'romantico', 'semanita'])]

print(f"Movies pools: {len(movies_streams)}, Series: {len(series_streams)}, Anime: {len(anime_streams)}, Novelas: {len(novelas_streams)}")

# Dedicated 17 UHD streams (1-to-1 unique mapping, ZERO duplicates)
uhd_map = [
    "https://jmp2.uk/plu-5f1ac2591dd8880007bb7d6d.m3u8", # Pluto Cine Acción
    "https://jmp2.uk/plu-5f6a38eaa5b68b0007a00e7a.m3u8", # Pluto Sci-Fi
    "https://jmp2.uk/plu-5f1ac1f1b66c76000790ef27.m3u8", # Pluto Cine Estelar
    "https://jmp2.uk/plu-5f1ac8a87cd38d000745d7cf.m3u8", # Pluto Thrillers
    "https://jmp2.uk/plu-5cf968040ab7d8f181e6a68b.m3u8", # Pluto Premiere
    "https://d2mr4fu91mjx9m.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-rb0tx75ojbc5u/CineFriki_ES.m3u8", # Cine Friki 1080p
    "http://15.204.196.147:22880/CABLE-MAGES-AZCINEMA/video.m3u8", # Az Cinema 1080p
    "http://138.121.15.230:9002/CINECANAL/index.m3u8", # Cinecanal 1080p
    "http://23.237.104.106:8080/USA_MOREMAX/index.m3u8", # Cinemax Hits 1080p
    "https://origin.dpsgo.com/ssai/event/GI-9cp_bT8KcerLpZwkuhw/master.m3u8", # 13C 1080p
    "https://origin.dpsgo.com/ssai/event/Nftd0fM2SXasfDlRphvUsg/master.m3u8", # 13 Festival 1080p
    "https://d2nq34q0i1r3la.cloudfront.net/v1/master/3722c60a815c199d9c0ef3/Western_ES.m3u8", # Cine Western 1080p
    "https://jmp2.uk/plu-5d8d164d92e97a5e107638d2.m3u8", # Cine Adrenalina
    "https://streaming.onnethn.com/CINEMAX/playlist.m3u8", # Cinemax LatAm
    "https://a-cdn.klowdtv.com/live1/cine_720p/playlist.m3u8", # Cine Sony
    "http://23.237.104.106:8080/USA_CINEMAX_WEST/index.m3u8", # Cinemax West
    "https://jmp2.uk/plu-600ae6a78d801e0007117d21.m3u8"  # Pluto Animales
]

# Dedicated Anime streams mapping
anime_title_streams = {
    'sailor moon': 'https://jmp2.uk/plu-637e55347427a40007fac703.m3u8',
    'detective conan': 'https://jmp2.uk/plu-629a066860ef810008267b70.m3u8',
    'inuyasha': 'https://jmp2.uk/plu-67c63b90a20c0399a381b816.m3u8',
    'naruto': 'https://jmp2.uk/plu-5da0c85bd2c9c10009370984.m3u8',
    'boruto': 'https://jmp2.uk/plu-696997049889f8db34c936c2.m3u8',
    'yu-gi-oh': 'https://jmp2.uk/plu-63eb96754e83e70008ab8941.m3u8',
    'saint seiya': 'https://jmp2.uk/plu-680ba8c3a48b3ead0db701cc.m3u8',
    'caballeros del zodiaco': 'https://jmp2.uk/plu-680ba8c3a48b3ead0db701cc.m3u8',
    'one piece': 'https://jmp2.uk/plu-5f7790b3ed0c88000720b241.m3u8',
    'dragon ball': 'https://jmp2.uk/plu-685a996c7c4f2ad40cb4f276.m3u8',
    'dragon ball z': 'https://jmp2.uk/plu-68e8fd7c3ede4398bc69af93.m3u8',
    'inazuma eleven': 'https://jmp2.uk/plu-632c6df43d2bc5000751f621.m3u8',
    'lupin': 'https://jmp2.uk/plu-683457e5f59cc6a13212fce4.m3u8',
    'slam dunk': 'https://jmp2.uk/plu-608035b8d8705f0007260287.m3u8',
    'captain tsubasa': 'https://cdnlive.klicgo.net/maxanime/live/playlist.m3u8',
    'supercampeones': 'https://cdnlive.klicgo.net/maxanime/live/playlist.m3u8',
    'trigun': 'https://jmp2.uk/plu-6793eaa4bc03978b9bc63db1.m3u8',
    'rurouni kenshin': 'https://jmp2.uk/plu-65652f7fc0fc88000883537a.m3u8',
    'samurai x': 'https://jmp2.uk/plu-65652f7fc0fc88000883537a.m3u8',
    'cardcaptor sakura': 'https://jmp2.uk/plu-5dcde17bf6591d0009839e02.m3u8',
    'sakura': 'https://jmp2.uk/plu-5dcde17bf6591d0009839e02.m3u8',
    'mazinger z': 'https://jmp2.uk/plu-608035b8d8705f0007260287.m3u8',
    'ranma 1/2': 'https://cdnlive.klicgo.net/maxanime/live/playlist.m3u8',
    'demon slayer': 'https://jmp2.uk/plu-6793eaa4bc03978b9bc63db1.m3u8',
    'kimetsu': 'https://jmp2.uk/plu-6793eaa4bc03978b9bc63db1.m3u8',
    'jujutsu kaisen': 'https://jmp2.uk/plu-65652f7fc0fc88000883537a.m3u8',
    'attack on titan': 'https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8',
    'shingeki': 'https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8',
    'death note': 'https://jmp2.uk/plu-6793eaa4bc03978b9bc63db1.m3u8',
    'code geass': 'https://jmp2.uk/plu-5dcde17bf6591d0009839e02.m3u8',
    'evangelion': 'https://jmp2.uk/plu-608035b8d8705f0007260287.m3u8',
    'cowboy bebop': 'https://jmp2.uk/plu-6793eaa4bc03978b9bc63db1.m3u8'
}

# Verified classic anime posters (HTTP 200 confirmed Metahub)
anime_posters = {
    'slam dunk': 'https://images.metahub.space/poster/small/tt0106138/img',
    'captain tsubasa': 'https://images.metahub.space/poster/small/tt0283731/img',
    'supercampeones': 'https://images.metahub.space/poster/small/tt0283731/img',
    'trigun': 'https://images.metahub.space/poster/small/tt0251439/img',
    'rurouni kenshin': 'https://images.metahub.space/poster/small/tt0115341/img',
    'samurai x': 'https://images.metahub.space/poster/small/tt0115341/img',
    'cardcaptor sakura': 'https://images.metahub.space/poster/small/tt0222534/img',
    'mazinger z': 'https://images.metahub.space/poster/small/tt0068104/img',
    'saint seiya': 'https://images.metahub.space/poster/small/tt0161175/img',
    'caballeros del zodiaco': 'https://images.metahub.space/poster/small/tt0161175/img',
    'sailor moon': 'https://images.metahub.space/poster/small/tt0103534/img',
    'ranma 1/2': 'https://images.metahub.space/poster/small/tt0096686/img',
    'yu-gi-oh': 'https://images.metahub.space/poster/small/tt0249327/img',
    'inuyasha': 'https://images.metahub.space/poster/small/tt0290223/img',
    'fullmetal alchemist': 'https://images.metahub.space/poster/small/tt1355642/img'
}

print("Reading src/data.js...")
with open('/Users/rleon/Documents/SwordTV/src/data.js', 'r', encoding='utf-8') as f:
    code = f.read()

# We will parse the file by loading it as JSON sections or regex replacement
# Let's inspect where MOVIES, SERIES, ANIME, NOVELAS, UHD_ITEMS start and end.
import re

def replace_block(text, var_name, process_fn):
    pattern = rf'(export const {var_name} = )(\[[\s\S]*?\])(;\n\nexport const|;\n\n$)'
    match = re.search(pattern, text)
    if not match:
        print(f"Could not match {var_name}")
        return text
    prefix = match.group(1)
    raw_json = match.group(2)
    suffix = match.group(3)
    data = json.loads(raw_json)
    print(f"Processing {var_name}: {len(data)} items...")
    new_data = process_fn(data)
    new_json = json.dumps(new_data, ensure_ascii=False, indent=2)
    return text[:match.start()] + prefix + new_json + suffix + text[match.end():]

# Process UHD items: 17 unique streams
def process_uhd(items):
    for idx, item in enumerate(items):
        stream = uhd_map[idx % len(uhd_map)]
        item['streamUrl'] = stream
    return items

# Process NOVELAS items:
def process_novelas(items):
    for idx, item in enumerate(items):
        stream = novelas_streams[idx % len(novelas_streams)]
        item['streamUrl'] = stream
        if 'seasonList' in item and isinstance(item['seasonList'], list):
            for s_idx, season in enumerate(item['seasonList']):
                if 'episodes' in season and isinstance(season['episodes'], list):
                    for e_idx, ep in enumerate(season['episodes']):
                        ep_stream = novelas_streams[(idx * 3 + s_idx * 5 + e_idx) % len(novelas_streams)]
                        ep['streamUrl'] = ep_stream
    return items

# Process ANIME items:
def process_anime(items):
    filtered_items = []
    # Blocklist western cartoons from anime once and for all
    western = ['south park', 'simpson', 'rick and morty', 'family guy', 'haunted hotel', 'american dad', 'futurama', 'bojack', 'big mouth', 'king of the hill', 'bob\'s burgers', 'disenchantment', 'archer', 'solar opposites']
    
    for idx, item in enumerate(items):
        t_lower = (item.get('title') or '').lower()
        if any(w in t_lower for w in western):
            print(f"Purging western cartoon from anime: {item.get('title')}")
            continue

        # Check for poster fix
        for key, p_url in anime_posters.items():
            if key in t_lower:
                item['poster'] = p_url
                print(f"Updated poster for {item.get('title')} -> {p_url}")
                break

        # Check for stream
        stream = None
        for key, s_url in anime_title_streams.items():
            if key in t_lower:
                stream = s_url
                break
        if not stream:
            stream = anime_streams[idx % len(anime_streams)]

        item['streamUrl'] = stream

        if 'seasonList' in item and isinstance(item['seasonList'], list):
            for s_idx, season in enumerate(item['seasonList']):
                if 'episodes' in season and isinstance(season['episodes'], list):
                    for e_idx, ep in enumerate(season['episodes']):
                        # For Sailor Moon / Conan / Inuyasha, preserve their dedicated stream for all episodes!
                        if any(k in t_lower for k in ['sailor moon', 'conan', 'inuyasha', 'naruto', 'yu-gi-oh', 'saint seiya', 'one piece', 'dragon ball']):
                            ep['streamUrl'] = stream
                        else:
                            ep['streamUrl'] = anime_streams[(idx * 3 + s_idx * 5 + e_idx) % len(anime_streams)]

        filtered_items.append(item)
    return filtered_items

# Process MOVIES items:
def process_movies(items):
    for idx, item in enumerate(items):
        stream = movies_streams[idx % len(movies_streams)]
        item['streamUrl'] = stream
    return items

# Process SERIES items:
def process_series(items):
    for idx, item in enumerate(items):
        stream = series_streams[idx % len(series_streams)]
        item['streamUrl'] = stream
        if 'seasonList' in item and isinstance(item['seasonList'], list):
            for s_idx, season in enumerate(item['seasonList']):
                if 'episodes' in season and isinstance(season['episodes'], list):
                    for e_idx, ep in enumerate(season['episodes']):
                        ep['streamUrl'] = series_streams[(idx * 3 + s_idx * 5 + e_idx) % len(series_streams)]
    return items

code = replace_block(code, 'UHD_ITEMS', process_uhd)
code = replace_block(code, 'NOVELAS', process_novelas)
code = replace_block(code, 'ANIME', process_anime)
code = replace_block(code, 'MOVIES', process_movies)
code = replace_block(code, 'SERIES', process_series)

with open('/Users/rleon/Documents/SwordTV/src/data.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Successfully updated src/data.js!")
