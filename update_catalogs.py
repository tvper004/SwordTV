#!/usr/bin/env python3
import json
import glob
import re
import os

def clean_channel_name(n):
    n = re.sub(r'\[.*?\]', '', n)
    n = re.sub(r'\(.*?\)', '', n)
    n = re.sub(r'GEO|CAT|ES|HD|FHD', '', n)
    n = re.sub(r'\s+', ' ', n)
    return n.strip()

def map_group_to_subcat(name, group):
    n_low = name.lower()
    g_low = group.lower()
    if any(k in n_low or k in g_low for k in ['noticia', 'news', 'info', '24h', 'euronews', 'dw']):
        return 'noticias'
    if any(k in n_low or k in g_low for k in ['deporte', 'sport', 'futbol', 'tdp', 'motor', 'padel']):
        return 'deportes'
    if any(k in n_low or k in g_low for k in ['anime', 'manga', 'dragon ball', 'one piece', 'naruto', 'conan', 'inuyasha', 'sailor moon', 'animacion']):
        return 'anime'
    if any(k in n_low or k in g_low for k in ['infantil', 'kid', 'junior', 'boing', 'clan', 'dibujo', 'esponja', 'baby']):
        return 'infantil'
    if any(k in n_low or k in g_low for k in ['cine', 'movie', 'film', 'pelicula', 'accion', 'terror', 'thriller', 'sci-fi', 'drama', 'cinema', 'kino']):
        return 'cine'
    if any(k in n_low or k in g_low for k in ['serie', 'novela', 'forense', 'detective', 'comedia', 'misterio']):
        return 'series'
    if any(k in n_low or k in g_low for k in ['musica', 'music', 'mtv', 'radio', 'fm', 'hit', 'concert', 'latina']):
        return 'musica'
    if any(k in n_low or k in g_low for k in ['cultura', 'cocina', 'animal', 'viaje', 'naturaleza', 'doc', 'historia']):
        return 'cultura'
    if any(k in n_low or k in g_low for k in ['adult', 'erotic', '+18', 'xxx', 'playboy', 'venus', 'hustler']):
        return 'adultos'
    return 'entretenimiento'

def parse_m3u(file_path, default_subcat='general'):
    channels = []
    if not os.path.exists(file_path):
        return channels
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    current_meta = {}
    for line in lines:
        line = line.strip()
        if line.startswith('#EXTINF:'):
            name_match = re.search(r',([^,]+)$', line)
            logo_match = re.search(r'tvg-logo=\"([^\"]+)\"', line)
            group_match = re.search(r'group-title=\"([^\"]+)\"', line)
            raw_name = name_match.group(1).strip() if name_match else 'Canal'
            current_meta = {
                'raw_name': raw_name,
                'name': clean_channel_name(raw_name),
                'logo': logo_match.group(1).strip() if logo_match else 'assets/backdrop.png',
                'group': group_match.group(1).strip() if group_match else default_subcat
            }
        elif line.startswith('http://') or line.startswith('https://'):
            if current_meta:
                if ('ottera.tv' not in line and 
                    'jmp2.uk' not in line and 
                    'mux.dev' not in line and 
                    'BigBuckBunny' not in line and
                    'commondatastorage' not in line):
                    current_meta['url'] = line
                    channels.append(current_meta)
                current_meta = {}
    return channels

VERIFIED_NATIONAL = [
    {
        "name": "La 1 HD Directo",
        "subcat": "entretenimiento",
        "country": "España",
        "currentShow": "Telediario 1 y Magacín Matinal",
        "nextShow": "La Promesa (Serie TDT)",
        "quality": "1080p HD",
        "streamUrl": "https://rtvelivestream.rtve.es/rtvesec/la1/la1_main_dvr.m3u8"
    },
    {
        "name": "La 2 HD Directo",
        "subcat": "cultura",
        "country": "España",
        "currentShow": "Saber y Ganar • Documentales",
        "nextShow": "Grandes Documentales de la 2",
        "quality": "1080p HD",
        "streamUrl": "https://rtvelivestream.rtve.es/rtvesec/la2/la2_main_dvr.m3u8"
    },
    {
        "name": "RTVE 24 Horas Noticias",
        "subcat": "noticias",
        "country": "España",
        "currentShow": "Noticias 24h En Directo",
        "nextShow": "La Tarde en 24h",
        "quality": "1080p HD",
        "streamUrl": "https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8"
    },
    {
        "name": "Teledeporte RTVE HD",
        "subcat": "deportes",
        "country": "España",
        "currentShow": "Estudio Estadio y Directos Deportivos",
        "nextShow": "Conexión TDP Central",
        "quality": "1080p HD",
        "streamUrl": "https://rtvelivestream.rtve.es/rtvesec/tdp/tdp_main.m3u8"
    },
    {
        "name": "Clan RTVE Infantil",
        "subcat": "infantil",
        "country": "España",
        "currentShow": "Peppa Pig • Bob Esponja",
        "nextShow": "Paw Patrol La Patrulla Canina",
        "quality": "720p HD",
        "streamUrl": "https://rtvelivestream.rtve.es/rtvesec/clan/clan_main_dvr.m3u8"
    },
    {
        "name": "DW Español Internacional",
        "subcat": "noticias",
        "country": "Alemania",
        "currentShow": "El Diario Internacional",
        "nextShow": "Economía & Actualidad Global",
        "quality": "1080p HD",
        "streamUrl": "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8"
    }
]

tdt_channels = parse_m3u('tdtchannels-espana-hd.m3u', 'entretenimiento')

all_channels = []
seen_urls = set()
num = 1

for ch in VERIFIED_NATIONAL:
    seen_urls.add(ch['streamUrl'])
    all_channels.append({
        "id": f"ch-{num}",
        "num": num,
        "name": ch["name"],
        "subcat": ch["subcat"],
        "country": ch.get("country", "España"),
        "currentShow": ch.get("currentShow", "Emisión en Directo"),
        "nextShow": ch.get("nextShow", "Continuación de Programación"),
        "quality": ch.get("quality", "1080p HD"),
        "streamUrl": ch["streamUrl"]
    })
    num += 1

for ch in tdt_channels:
    u = ch['url']
    if u in seen_urls: continue
    seen_urls.add(u)
    name = ch['name']
    if not name or len(name) < 2: continue
    sub = map_group_to_subcat(name, ch['group'])
    all_channels.append({
        "id": f"ch-{num}",
        "num": num,
        "name": name,
        "subcat": sub,
        "country": "España",
        "currentShow": "Emisión en Directo",
        "nextShow": "Continuación de Emisión",
        "quality": "720p/1080p HD",
        "streamUrl": u
    })
    num += 1

print(f"Total compiled clean channels: {len(all_channels)}")

# Verified VOD Streams (Apple HLS + high performance trailers)
vod_streams = [
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8",
    "https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-1080p.mp4",
    "https://vjs.zencdn.net/v/oceans.mp4"
]

def make_stream(idx):
    return vod_streams[idx % len(vod_streams)]

def make_poster(imdb_id):
    return f"https://images.metahub.space/poster/medium/{imdb_id}/img"

def make_backdrop(imdb_id):
    return f"https://images.metahub.space/background/medium/{imdb_id}/img"

# 1. Expanded Movies (50+ blockbusters across all genres)
MOVIES_SEED = [
    ("tt15239678", "Dune: Parte Dos (Dune: Part Two)", "Ciencia Ficción / Aventura", "9.0", 2024, "2h 46m", "4K UHD", "Paul Atreides se une a Chani y a los Fremen mientras busca venganza contra los conspiradores que destruyeron a su familia."),
    ("tt6263850", "Deadpool & Wolverine", "Acción / Comedia / Superhéroes", "8.9", 2024, "2h 07m", "4K UHD", "Wade Wilson se une a un reacio Wolverine en una misión que cambiará la historia del Multiverso de Marvel."),
    ("tt22022452", "Intensamente 2 (Del Revés 2)", "Animación / Aventura / Familia", "8.8", 2024, "1h 36m", "4K UHD", "Riley entra a la adolescencia y el Cuartel General sufre una demolición repentina para hacer espacio a la Ansiedad y nuevas emociones."),
    ("tt6587046", "El Niño y la Garza (The Boy and the Heron)", "Studio Ghibli / Fantasía / Animación", "9.0", 2023, "2h 04m", "4K UHD", "Obra maestra de Hayao Miyazaki. Mahito entra en un mundo mágico compartido por vivos y muertos guiado por una garza parlante."),
    ("tt6718170", "Super Mario Bros: La Película", "Animación / Aventura / Comedia", "8.7", 2023, "1h 32m", "4K UHD", "Un fontanero llamado Mario viaja a través del Reino Champiñón con la Princesa Peach para salvar a su hermano Luigi."),
    ("tt15398776", "Oppenheimer", "Drama Histórico / Biografía / Suspenso", "9.3", 2023, "3h 00m", "4K UHD", "La historia del físico estadounidense J. Robert Oppenheimer y su rol en el desarrollo de la bomba atómica."),
    ("tt9362722", "Spider-Man: A Través del Spider-Verso", "Animación / Acción / Superhéroes", "9.1", 2023, "2h 20m", "4K UHD", "Miles Morales es catapultado a través del Multiverso y se enfrenta a un escuadrón de Spider-Gente para salvar a quienes ama."),
    ("tt16428256", "Suzume", "Anime / Fantasía / Drama", "8.9", 2022, "2h 02m", "4K UHD", "Una joven de 17 años ayuda a un misterioso viajero a cerrar puertas en ruinas por todo Japón que liberan desastres sobrenaturales."),
    ("tt1630029", "Avatar: El Sentido del Agua", "Ciencia Ficción / Aventura", "9.0", 2022, "3h 12m", "4K UHD", "Jake Sully vive con su nueva familia en Pandora. Una amenaza familiar regresa para acabar con lo que comenzó."),
    ("tt0816692", "Interstellar (Interestelar)", "Ciencia Ficción / Drama", "9.4", 2014, "2h 49m", "4K UHD", "Un grupo de exploradores espaciales viaja a través de un agujero de gusano para asegurar el futuro de la humanidad."),
    ("tt10366206", "John Wick 4 (Capítulo 4)", "Acción / Suspenso / Artes Marciales", "9.1", 2023, "2h 49m", "4K UHD", "John Wick descubre un camino para derrotar a la Alta Mesa, enfrentándose a nuevos enemigos con poderosas alianzas."),
    ("tt1745960", "Top Gun: Maverick", "Acción / Aventura / Drama", "9.2", 2022, "2h 10m", "4K UHD", "Después de más de 30 años de servicio, Pete Maverick Mitchell entrena a un destacamento de graduados de Top Gun para una misión letal."),
    ("tt12037194", "Furiosa: De la Saga Mad Max", "Acción / Ciencia Ficción", "8.8", 2024, "2h 28m", "4K UHD", "La joven Furiosa es arrebatada del Lugar Verde y cae en manos de la gran Horda de Motoristas liderada por Dementus."),
    ("tt0468569", "El Caballero de la Noche (The Dark Knight)", "Acción / Crimen / Drama", "9.5", 2008, "2h 32m", "4K UHD", "Batman se enfrenta al Joker, una mente criminal desquiciada que sumerge a Gotham City en la anarquía y el terror."),
    ("tt4154796", "Avengers: Endgame", "Acción / Ciencia Ficción / Superhéroes", "9.3", 2019, "3h 01m", "4K UHD", "Tras los devastadores eventos de Infinity War, los Vengadores sobrevivientes se reúnen una vez más para revertir el daño de Thanos."),
    ("tt1375666", "Inception (El Origen)", "Ciencia Ficción / Suspenso / Acción", "9.2", 2010, "2h 28m", "4K UHD", "Un ladrón con la habilidad de infiltrarse en los sueños de los demás recibe la tarea inversa: implantar una idea en la mente de un magnate."),
    ("tt1160419", "Dune: Parte Uno", "Ciencia Ficción / Aventura", "8.9", 2021, "2h 35m", "4K UHD", "Paul Atreides debe viajar al planeta más peligroso del universo para asegurar el futuro de su familia y su pueblo."),
    ("tt10872600", "Spider-Man: Sin Camino a Casa", "Acción / Superhéroes / Fantasía", "9.0", 2021, "2h 28m", "4K UHD", "Con la identidad de Peter Parker revelada, un hechizo del Doctor Strange abre grietas en el Multiverso trayendo villanos de otros mundos."),
    ("tt0133093", "Matrix (The Matrix)", "Ciencia Ficción / Acción", "9.3", 1999, "2h 16m", "4K UHD", "Un hacker llamado Neo descubre la perturbadora verdad sobre su realidad y su papel estelar en la guerra contra sus controladores."),
    ("tt0172495", "Gladiador (Gladiator)", "Acción / Aventura / Drama Histórico", "9.1", 2000, "2h 35m", "4K UHD", "Un general romano traicionado busca venganza contra el corrupto emperador que asesinó a su familia y lo redujo a la esclavitud."),
    ("tt1392190", "Mad Max: Furia en el Camino", "Acción / Aventura / Ciencia Ficción", "9.2", 2015, "2h 00m", "4K UHD", "En un desierto postapocalíptico, Max se une a Furiosa para huir de una ciudadela tiranizada por Immortan Joe a bordo de un camión de guerra."),
    ("tt1856101", "Blade Runner 2049", "Ciencia Ficción / Misterio / Suspenso", "8.9", 2017, "2h 44m", "4K UHD", "El oficial K, un replicante blade runner de la policía de Los Ángeles, descubre un secreto largamente enterrado que lo lleva hasta Rick Deckard."),
    ("tt0068646", "El Padrino (The Godfather)", "Crimen / Drama", "9.7", 1972, "2h 55m", "4K UHD", "El patriarca envejecido de una dinastía del crimen organizado transfiere el control de su imperio clandestino a su hijo reacio."),
    ("tt0110912", "Pulp Fiction (Tiempos Violentos)", "Crimen / Drama / Comedia Negra", "9.4", 1994, "2h 34m", "4K UHD", "Las vidas de dos sicarios de la mafia, la esposa de un gángster y un boxeador en decadencia se entrelazan en cuatro relatos de violencia."),
    ("tt0137523", "El Club de la Pelea (Fight Club)", "Drama / Suspenso / Psicológico", "9.2", 1999, "2h 19m", "4K UHD", "Un oficinista insomne en busca de un cambio forma un club de combate subterráneo con un excéntrico fabricante de jabón."),
    ("tt0111161", "Sueño de Fuga (The Shawshank Redemption)", "Drama / Crimen", "9.8", 1994, "2h 22m", "4K UHD", "Andy Dufresne es encarcelado injustamente de por vida. A lo largo de los años se gana el respeto de sus compañeros y urde un plan maestro."),
    ("tt6751668", "Parásitos (Parasite)", "Suspenso / Drama / Comedia Negra", "9.2", 2019, "2h 12m", "4K UHD", "La codicia y la discriminación de clases amenazan la recién formada relación simbiótica entre la adinerada familia Park y el empobrecido clan Kim."),
    ("tt7286456", "Joker", "Crimen / Drama / Suspenso Psicológico", "9.1", 2019, "2h 02m", "4K UHD", "Arthur Fleck, un comediante fracasado con problemas mentales, cae en una espiral de locura y se convierte en el icónico villano de Gotham."),
    ("tt0109830", "Forrest Gump", "Drama / Romance / Comedia", "9.3", 1994, "2h 22m", "4K UHD", "Las presidencias de Kennedy y Johnson, Vietnam y Watergate se desarrollan a través de la perspectiva de un bondadoso hombre de Alabama."),
    ("tt0245429", "El Viaje de Chihiro (Spirited Away)", "Animación / Fantasía / Aventura", "9.3", 2001, "2h 05m", "4K UHD", "Durante el traslado de su familia, una niña de 10 años vaga por un mundo gobernado por dioses, brujas y espíritus."),
    ("tt5311514", "Your Name (Tu Nombre)", "Anime / Romance / Fantasía", "9.1", 2016, "1h 46m", "4K UHD", "Dos adolescentes descubren una conexión mágica al despertar de forma intermitente en el cuerpo del otro, separados por el tiempo y el espacio."),
    ("tt18412256", "Alien: Romulus", "Terror / Ciencia Ficción / Suspenso", "8.7", 2024, "1h 59m", "4K UHD", "Un grupo de jóvenes colonizadores espaciales se enfrenta a la forma de vida más aterradora del universo en una estación abandonada."),
    ("tt13433802", "Un Lugar en Silencio: Día Uno", "Terror / Suspenso / Ciencia Ficción", "8.6", 2024, "1h 39m", "4K UHD", "Descubre cómo el mundo guardó silencio el día en que Nueva York fue invadida por criaturas letales guiadas por el sonido."),
    ("tt6710474", "Todo en Todas Partes al Mismo Tiempo", "Acción / Aventura / Comedia / Multiverso", "9.1", 2022, "2h 19m", "4K UHD", "Una inmigrante china se ve envuelta en una aventura cósmica para salvar el multiverso conectando con las vidas que pudo haber vivido."),
    ("tt0167260", "El Señor de los Anillos: El Retorno del Rey", "Fantasía / Aventura / Épica", "9.6", 2003, "3h 21m", "4K UHD", "Gandalf y Aragorn lideran el Mundo de los Hombres contra el ejército de Sauron para alejar su mirada de Frodo y Sam en Mordor."),
    ("tt0120737", "El Señor de los Anillos: La Comunidad del Anillo", "Fantasía / Aventura / Épica", "9.5", 2001, "2h 58m", "4K UHD", "Un hobbit de la Comarca emprende un viaje con ocho compañeros hacia el Monte del Destino para destruir el Anillo Único."),
    ("tt0120338", "Titanic", "Drama / Romance / Histórico", "9.2", 1997, "3h 14m", "4K UHD", "Una aristócrata de diecisiete años se enamora de un bondadoso pero pobre artista a bordo del lujoso e infortunado R.M.S. Titanic."),
    ("tt1877830", "The Batman (2022)", "Acción / Crimen / Drama / Misterio", "8.9", 2022, "2h 56m", "4K UHD", "Cuando un sádico asesino en serie conocido como Acertijo comienza a matar figuras políticas de Gotham, Batman emprende una investigación letal."),
    ("tt9603212", "Misión Imposible: Sentencia Mortal", "Acción / Aventura / Suspenso", "9.0", 2023, "2h 43m", "4K UHD", "Ethan Hunt y su equipo del FMI se embarcan en su misión más peligrosa: rastrear una temible arma que amenaza a toda la humanidad."),
    ("tt1345836", "El Caballero de la Noche Asciende", "Acción / Drama / Suspenso", "9.0", 2012, "2h 44m", "4K UHD", "Ocho años después del reinado del Joker, el terrorista Bane obliga a Bruce Wayne a regresar de su exilio para salvar a Gotham."),
    ("tt3315342", "Logan (Wolverine)", "Acción / Drama / Ciencia Ficción", "9.1", 2017, "2h 17m", "4K UHD", "En un futuro cercano, un cansado Logan cuida de un enfermo Profesor X en la frontera mexicana, hasta que aparece una joven mutante perseguida."),
    ("tt0361748", "Bastardos Sin Gloria (Inglourious Basterds)", "Acción / Drama Histórico / Bélico", "9.2", 2009, "2h 33m", "4K UHD", "En la Francia ocupada por los nazis, un grupo de soldados judío-estadounidenses planea asesinar a los líderes del Tercer Reich."),
    ("tt1853728", "Django Desencadenado (Django Unchained)", "Acción / Drama / Western", "9.3", 2012, "2h 45m", "4K UHD", "Con la ayuda de un cazarrecompensas alemán, un esclavo liberado se propone rescatar a su esposa de un brutal terrateniente de Misisipi."),
    ("tt2278388", "El Gran Hotel Budapest", "Comedia / Aventura / Drama", "9.0", 2014, "1h 39m", "4K UHD", "Un legendario conserje en un famoso resort europeo y su fiel botones se ven involucrados en el robo de una pintura renacentista invaluable."),
    ("tt2582802", "Whiplash: Música y Obsesión", "Drama / Música / Suspenso", "9.2", 2014, "1h 47m", "4K UHD", "Un prometedor joven baterista se inscribe en un conservatorio de música donde su instructor no se detendrá ante nada para explotar su potencial."),
    ("tt4633694", "Spider-Man: Un Nuevo Universo", "Animación / Acción / Superhéroes", "9.1", 2018, "1h 57m", "4K UHD", "El adolescente de Brooklyn Miles Morales se convierte en el nuevo Spider-Man y une fuerzas con cinco justicieros arácnidos de otras dimensiones.")
]

movies_list = []
for idx, m in enumerate(MOVIES_SEED):
    imdb_id, title, genre, rating, year, duration, quality, synopsis = m
    movies_list.append({
        'id': f'mov-{imdb_id}',
        'title': title,
        'genre': genre,
        'rating': rating,
        'year': year,
        'duration': duration,
        'quality': quality,
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'streamUrl': make_stream(idx)
    })

print(f"Total compiled Movies: {len(movies_list)}")

# 2. Expanded Series (30+ premier TV series with episodes)
SERIES_SEED = [
    ("tt0903747", "Breaking Bad", "Crimen / Drama / Suspenso", "9.8", "2008-2013", 10, "Un profesor de química de secundaria diagnosticado con cáncer se asocia con un exalumno para fabricar y vender metanfetamina."),
    ("tt0944947", "Juego de Tronos (Game of Thrones)", "Fantasía / Aventura / Drama Épico", "9.5", "2011-2019", 10, "Nueve familias nobles luchan por el control de las tierras de Poniente mientras un antiguo enemigo acecha en el Norte."),
    ("tt3581920", "The Last of Us", "Acción / Aventura / Drama Postapocalíptico", "9.4", "2023-", 9, "Tras una pandemia que arrasa la civilización, un curtido contrabandista debe escoltar a una niña inmune de 14 años a través de EE.UU."),
    ("tt11198330", "La Casa del Dragón (House of the Dragon)", "Fantasía / Drama / Acción", "9.2", "2022-", 10, "La historia de la Casa Targaryen 200 años antes de los eventos de Game of Thrones y la guerra civil de dragones conocida como la Danza."),
    ("tt4574334", "Stranger Things", "Ciencia Ficción / Terror / Aventura", "9.3", "2016-", 8, "Cuando un niño desaparece en Hawkins, sus amigos y una enigmática niña con poderes telequinéticos descubren un mundo al revés."),
    ("tt8762206", "Chernobyl", "Drama Histórico / Suspenso", "9.7", "2019", 5, "En abril de 1986, una explosión en la planta nuclear de Chernobyl en la URSS se convierte en una de las mayores catástrofes de la humanidad."),
    ("tt1190634", "The Boys", "Acción / Comedia Negra / Superhéroes", "9.1", "2019-", 8, "Un grupo de vigilantes se propone derribar a superhéroes corruptos que abusan de sus superpoderes bajo el manto corporativo de Vought."),
    ("tt12637874", "Fallout", "Ciencia Ficción / Aventura / Acción", "9.2", "2024-", 8, "200 años después del apocalipsis nuclear, los pacíficos habitantes de los lujosos refugios atómicos regresan a la superficie irradiada."),
    ("tt2788316", "Shōgun", "Drama Histórico / Aventura / Guerra", "9.4", "2024-", 10, "En el Japón del año 1600, Lord Toranaga lucha por su vida cuando un misterioso barco europeo encalla en un pueblo pesquero vecino."),
    ("tt2442560", "Peaky Blinders", "Crimen / Drama Histórico", "9.3", "2013-2022", 6, "Una temible banda criminal de Birmingham en 1919, liderada por el ambicioso Tommy Shelby, busca ascender en el bajo mundo británico."),
    ("tt7660850", "Succession", "Drama / Negocios / Comedia Negra", "9.4", "2018-2023", 10, "La familia Roy lucha ferozmente por el control de Waystar RoyCo, uno de los conglomerados de medios y entretenimiento más grandes del mundo."),
    ("tt3032476", "Better Call Saul", "Crimen / Drama / Legal", "9.5", "2015-2022", 10, "Las pruebas y tribulaciones del abogado penalista Jimmy McGill antes de establecer su infame bufete legal en Albuquerque."),
    ("tt11126994", "Arcane: League of Legends", "Animación / Ciencia Ficción / Fantasía", "9.6", "2021-", 9, "Ambientada en la utópica región de Piltover y los oprimidos suburbios de Zaun, dos hermanas luchan en bandos opuestos de una guerra tecnológica."),
    ("tt11280740", "Severance (Separación)", "Ciencia Ficción / Suspenso Psicológico", "9.3", "2022-", 9, "Mark lidera un equipo de oficinistas cuyos recuerdos han sido divididos quirúrgicamente entre su vida laboral y personal."),
    ("tt14452792", "The Bear", "Drama / Comedia / Cocina", "9.2", "2022-", 10, "Un joven y brillante chef del mundo de la alta cocina regresa a Chicago para dirigir la tienda de sándwiches italianos de su familia."),
    ("tt0773262", "Dexter", "Crimen / Drama / Misterio", "9.1", "2006-2013", 12, "Un experto forense en patrones de manchas de sangre para la policía de Miami lleva una doble vida secreta como asesino en serie de criminales."),
    ("tt2306299", "Vikingos (Vikings)", "Acción / Aventura / Drama Histórico", "9.0", "2013-2020", 10, "Sigue las aventuras del legendario guerrero nórdico Ragnar Lothbrok en su ambición por navegar hacia el oeste y descubrir nuevas tierras."),
    ("tt1475582", "Sherlock", "Crimen / Drama / Misterio Moderno", "9.4", "2010-2017", 4, "Una actualización contemporánea del legendario detective Sherlock Holmes y el Dr. John Watson resolviendo crímenes en el Londres del siglo XXI."),
    ("tt5180504", "The Witcher", "Fantasía / Acción / Aventura", "8.9", "2019-", 8, "Geralt de Rivia, un cazador de monstruos mutado a sueldo, viaja hacia su destino en un mundo turbulento donde las personas son más perversas."),
    ("tt2085059", "Black Mirror", "Ciencia Ficción / Drama / Suspenso Distópico", "9.1", "2011-", 6, "Una serie de antología que explora un futuro retorcido y de alta tecnología donde las mayores innovaciones de la humanidad chocan con sus peores instintos."),
    ("tt5753856", "Dark", "Ciencia Ficción / Misterio / Viajes en el Tiempo", "9.3", "2017-2020", 10, "La desaparición de dos niños en el pueblo alemán de Winden saca a la luz los oscuros secretos y los lazos ocultos entre cuatro familias."),
    ("tt8111088", "The Mandalorian", "Ciencia Ficción / Aventura / Star Wars", "9.1", "2019-", 8, "Los viajes de un pistolero solitario en los confines exteriores de la galaxia, lejos de la autoridad de la Nueva República."),
    ("tt9140554", "Loki", "Acción / Aventura / Fantasía Marvel", "9.0", "2021-2023", 6, "El volátil villano Loki retoma su papel como el Dios de la Travesura tras huir con el Teseracto y caer en manos de la AVT."),
    ("tt2356777", "True Detective", "Crimen / Drama / Misterio Policial", "9.3", "2014-", 8, "Antología policial que sigue a detectives mientras investigan crímenes atroces que exponen los secretos más oscuros de la psique humana."),
    ("tt2707408", "Narcos", "Biografía / Crimen / Drama", "9.2", "2015-2017", 10, "Una mirada crónica al ascenso y caída del líder del Cartel de Medellín, Pablo Escobar, y los esfuerzos de la DEA por capturarlo."),
    ("tt6468322", "La Casa de Papel (Money Heist)", "Acción / Crimen / Suspenso", "9.0", "2017-2021", 10, "Un enigmático hombre conocido como El Profesor recluta a ocho ladrones con habilidades únicas para llevar a cabo el mayor atraco de la historia en la Fábrica Nacional de Moneda."),
    ("tt0141842", "Los Soprano (The Sopranos)", "Crimen / Drama", "9.6", "1999-2007", 13, "El líder de la mafia de Nueva Jersey, Tony Soprano, equilibra las exigencias de su familia criminal con su conflictiva vida doméstica."),
    ("tt0306414", "The Wire (Bajo Escucha)", "Crimen / Drama / Realismo", "9.6", "2002-2008", 13, "Una mirada cruda y realista a la escena de drogas de Baltimore vista a través de los ojos de los traficantes de drogas y los agentes de la ley."),
    ("tt10986410", "Ted Lasso", "Comedia / Drama / Deportes", "9.1", "2020-2023", 10, "Un entrenador de fútbol americano universitario viaja al Reino Unido para dirigir un club de fútbol británico de la Premier League sin tener idea."),
    ("tt13443470", "Merlina (Wednesday)", "Comedia / Fantasía / Misterio", "8.9", "2022-", 8, "Sigue los años de Merlina Addams como estudiante en la Academia Nevermore mientras intenta dominar su habilidad psíquica emergente.")
]

series_list = []
for idx, s in enumerate(SERIES_SEED):
    imdb_id, title, genre, rating, year, ep_count, synopsis = s
    ser_stream = make_stream(idx)
    eps = []
    for ep_num in range(1, ep_count + 1):
        eps.append({
            'num': ep_num,
            'title': f'Capítulo {ep_num}: {title.split("(")[0].strip()}',
            'duration': '52m',
            'streamUrl': ser_stream
        })
    series_list.append({
        'id': f'ser-{imdb_id}',
        'title': title,
        'genre': genre,
        'rating': rating,
        'year': year,
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'seasons': 1,
        'streamUrl': ser_stream,
        'seasonList': [{
            'seasonNum': 1,
            'episodes': eps
        }]
    })

print(f"Total compiled Series: {len(series_list)}")

# 3. Expanded Anime (28+ anime with episodes)
ANIME_SEED = [
    ("tt13616990", "Chainsaw Man", "Acción / Sobrenatural / Shonen", "9.1", "2022", 12, "Denji resucita como el Hombre Motosierra fusionándose con su demonio mascota Pochita."),
    ("tt0877057", "Death Note", "Misterio / Psicológico / Sobrenatural", "9.4", "2006", 37, "Un estudiante brillante encuentra un cuaderno sobrenatural que le otorga la habilidad de matar a cualquiera cuyo nombre escriba en él."),
    ("tt4644488", "Dragon Ball Super", "Acción / Fantasía / Artes Marciales", "9.0", "2015-2018", 131, "Goku y sus amigos enfrentan a deidades celestiales, el Dios de la Destrucción Beerus y guerreros de todos los universos."),
    ("tt0121955", "Dragon Ball Z", "Acción / Shonen / Artes Marciales", "9.5", "1989-1996", 291, "Goku defiende la Tierra de guerreros Saiyajin, el tirano Freezer, androides mortales y el temible Majin Buu."),
    ("tt22284988", "Frieren: Más allá del final del viaje", "Fantasía / Aventura / Drama", "9.6", "2023-2024", 28, "Tras derrotar al Rey Demonio, la elfa maga Frieren emprende un viaje para comprender las emociones y el valor del tiempo humano."),
    ("tt5626028", "My Hero Academia (Boku no Hero)", "Acción / Superhéroes / Shonen", "8.9", "2016-", 25, "En un mundo donde el 80% tiene superpoderes, el joven Deku nace sin dones pero hereda el poder legendario de All Might."),
    ("tt12343534", "Jujutsu Kaisen", "Acción / Fantasía Oscura / Sobrenatural", "9.2", "2020-", 24, "Yuji Itadori se traga un dedo maldito de Ryomen Sukuna y entra en el mundo secreto de los hechiceros jujutsu."),
    ("tt9335498", "Demon Slayer (Kimetsu no Yaiba)", "Acción / Histórico / Sobrenatural", "9.3", "2019-", 26, "Tanjiro Kamado se une al Cuerpo de Cazadores de Demonios tras la masacre de su familia y la transformación de su hermana Nezuko."),
    ("tt0988824", "Naruto Shippuden", "Acción / Aventura / Ninja", "9.2", "2007-2017", 500, "Naruto regresa a la Aldea de la Hoja tras años de entrenamiento para proteger a sus seres queridos de la organización Akatsuki."),
    ("tt0388629", "One Piece", "Aventura / Fantasía / Piratas", "9.4", "1999-", 1100, "Monkey D. Luffy y su tripulación de Piratas de Sombrero de Paja navegan el Grand Line en busca del legendario tesoro One Piece."),
    ("tt2560140", "Attack on Titan (Shingeki no Kyojin)", "Acción / Drama / Misterio", "9.6", "2013-2023", 25, "La humanidad vive confinada dentro de enormes murallas para protegerse de los gigantescos Titanes devoradores de humanos."),
    ("tt21209876", "Solo Leveling", "Acción / Fantasía / RPG", "9.1", "2024-", 12, "En un mundo donde cazadores despiertan habilidades, el cazador más débil Sung Jinwoo recibe un sistema de misiones secreto."),
    ("tt13706018", "Spy x Family", "Comedia / Acción / Espías", "9.0", "2022-", 25, "Un espía maestro crea una familia ficticia con una asesina letal y una niña huérfana con poderes telepáticos para una misión encubierta."),
    ("tt11958344", "Bleach: Thousand-Year Blood War", "Acción / Sobrenatural / Shonen", "9.4", "2022-", 13, "La paz de la Sociedad de Almas se quiebra cuando el ejército Quincy de Wandenreich declara la guerra definitiva a los Segadores de Almas."),
    ("tt2098220", "Hunter x Hunter (2011)", "Aventura / Fantasía / Shonen", "9.5", "2011-2014", 148, "Gon Freecss descubre que su padre sigue vivo y es un legendario Cazador, emprendiendo el riguroso Examen de Cazadores."),
    ("tt1355644", "Fullmetal Alchemist: Brotherhood", "Aventura / Fantasía / Drama", "9.7", "2009-2010", 64, "Dos hermanos alquimistas buscan la Piedra Filosofal tras un fallido intento de transmutación humana para revivir a su madre."),
    ("tt12590266", "Cyberpunk: Edgerunners", "Ciencia Ficción / Acción / Cyberpunk", "9.2", "2022", 10, "En una distopía plagada de corrupción e implantes cibernéticos, un joven de la calle intenta sobrevivir convirtiéndose en un mercenario fuera de la ley."),
    ("tt10233448", "Vinland Saga", "Acción / Drama Histórico / Vikingos", "9.3", "2019-", 24, "Thorfinn persigue al asesino de su padre para desafiarlo a un duelo a muerte, viéndose arrastrado a la guerra por la corona de Inglaterra."),
    ("tt3741634", "Tokyo Ghoul", "Terror / Acción / Fantasía Oscura", "8.7", "2014", 12, "Un tímido estudiante universitario es transformado en medio-ghoul tras sobrevivir a un encuentro letal en Tokio."),
    ("tt1910272", "Steins;Gate", "Ciencia Ficción / Suspenso / Viajes en el Tiempo", "9.5", "2011", 24, "Un autoproclamado científico loco inventa accidentalmente un microondas que puede enviar mensajes de texto al pasado."),
    ("tt0213338", "Cowboy Bebop", "Ciencia Ficción / Neo-Noir / Aventura Espacial", "9.4", "1998", 26, "Las desventuras y tragedias de un grupo de cazarrecompensas que viajan por el sistema solar a bordo de la nave Bebop."),
    ("tt0112159", "Neon Genesis Evangelion", "Ciencia Ficción / Psicológico / Mecha", "9.2", "1995", 26, "Shinji Ikari es reclutado por su distante padre para pilotar el bio-mecha Evangelion Unidad 01 y combatir a misteriosos Ángeles."),
    ("tt5897304", "Mob Psycho 100", "Acción / Comedia / Sobrenatural", "9.1", "2016-2022", 12, "Shigeo Kageyama, apodado Mob, es un chico de secundaria con poderes psíquicos abrumadores que intenta llevar una vida normal."),
    ("tt4508902", "One Punch Man", "Acción / Comedia / Superhéroes", "9.2", "2015-", 12, "Saitama es un héroe por diversión tan absurdamente poderoso que puede derrotar a cualquier enemigo de un solo puñetazo."),
    ("tt0994314", "Code Geass: Lelouch of the Rebellion", "Acción / Mecha / Drama Militar", "9.3", "2006-2008", 25, "Un príncipe británico exiliado obtiene el poder absoluto del Geass y lidera una rebelión enmascarada contra el Santo Imperio de Britannia."),
    ("tt3563434", "Haikyuu!! (Los Ases del Vóley)", "Deportes / Comedia / Shonen", "9.1", "2014-", 25, "Shoyo Hinata, inspirado por un jugador prodigio de baja estatura, revive el club de voleibol de la preparatoria Karasuno."),
    ("tt15229606", "Blue Lock", "Deportes / Suspenso / Fútbol", "8.9", "2022-", 24, "La Asociación Japonesa de Fútbol encierra a 300 jóvenes delanteros en una prisión de alta tecnología para forjar al delantero más egoísta del mundo."),
    ("tt21217316", "Mashle: Magic and Muscles", "Comedia / Fantasía / Acción", "8.8", "2023-", 12, "En un mundo donde la magia lo es todo, Mash Burnedead nace sin una sola gota de magia pero con músculos sobrehumanos que desafían la hechicería.")
]

anime_list = []
for idx, a in enumerate(ANIME_SEED):
    imdb_id, title, genre, rating, year, ep_count, synopsis = a
    ani_stream = make_stream(idx)
    eps = []
    for ep_num in range(1, ep_count + 1):
        eps.append({
            'num': ep_num,
            'title': f'Capítulo {ep_num}: {title.split("(")[0].strip()}',
            'duration': '24m',
            'streamUrl': ani_stream
        })
    anime_list.append({
        'id': f'ani-{imdb_id}',
        'title': title,
        'genre': genre,
        'rating': rating,
        'year': year,
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'episodesCount': ep_count,
        'streamUrl': ani_stream,
        'seasons': 1,
        'seasonList': [{
            'seasonNum': 1,
            'episodes': eps
        }]
    })

print(f"Total compiled Anime: {len(anime_list)}")

# 4. Expanded Kids (24 titles)
KIDS_SEED = [
    ("tt22022452", "Intensamente 2 (Del Revés 2)", "Animación / Familia", 2024, "1h 36m", "8.8", "Sigue a Riley en su adolescencia mientras experimenta nuevas emociones como Ansiedad, Vergüenza y Envidia."),
    ("tt6718170", "Super Mario Bros: La Película", "Animación / Aventura", 2023, "1h 32m", "8.7", "Mario y Luigi son transportados a un mundo mágico subterráneo para enfrentarse a Bowser."),
    ("tt21692408", "Kung Fu Panda 4", "Animación / Artes Marciales", 2024, "1h 34m", "8.6", "Po se prepara para convertirse en líder espiritual del Valle de la Paz mientras busca al nuevo Guerrero Dragón."),
    ("tt9362722", "Spider-Man: Cruzando el Multiverso", "Animación / Superhéroes", 2023, "2h 20m", "9.1", "Miles Morales viaja a través del multiverso con Gwen Stacy encontrándose con cientos de versiones arácnidas."),
    ("tt5113044", "Minions: El Origen de Gru", "Comedia / Animación", 2022, "1h 27m", "8.5", "En los años 70, un joven Gru sueña con unirse a los Vicio6 con la ayuda de sus fieles Minions."),
    ("tt6105098", "El Rey León (The Lion King)", "Animación / Aventura / Clásico", 2019, "1h 58m", "8.7", "Simba idolatra a su padre, el rey Mufasa, pero debe huir de la sabana tras una trágica traición familiar."),
    ("tt1979376", "Toy Story 4", "Animación / Aventura / Comedia", 2019, "1h 40m", "8.6", "Woody, Buzz y la pandilla dan la bienvenida a Forky en un viaje por carretera que revela lo grande que es el mundo."),
    ("tt2953050", "Encanto", "Animación / Musical / Fantasía", 2021, "1h 42m", "8.8", "Una familia colombiana extraordinaria vive en una casa mágica donde cada niño tiene un don único, excepto Mirabel."),
    ("tt2380307", "Coco", "Animación / Familia / Música", 2017, "1h 45m", "9.2", "El aspirante a músico Miguel se adentra en la deslumbrante Tierra de los Muertos para descubrir el secreto de su familia."),
    ("tt2948356", "Zootrópolis (Zootopia)", "Animación / Comedia / Aventura", 2016, "1h 48m", "8.9", "En una metrópolis de mamíferos antropomórficos, una conejita policía y un zorro estafador resuelven una gran conspiración."),
    ("tt0298148", "Shrek 2", "Animación / Comedia / Parodia", 2004, "1h 33m", "9.0", "Shrek y Fiona viajan al Reino de Muy Muy Lejano para conocer a los padres de ella con resultados hilarantes."),
    ("tt3606756", "Los Increíbles 2", "Animación / Superhéroes", 2018, "1h 58m", "8.7", "Helen es llamada para liderar una campaña que traiga de vuelta a los superhéroes mientras Bob cuida a Jack-Jack."),
    ("tt0382932", "Ratatouille", "Animación / Comedia / Cocina", 2007, "1h 51m", "8.9", "Una rata con extraordinario sentido del gusto forja una improbable alianza con un joven chef en un prestigioso restaurante de París."),
    ("tt0910970", "WALL-E", "Animación / Ciencia Ficción / Aventura", 2008, "1h 38m", "9.2", "En un futuro distante, un pequeño robot recolector de basura emprende un viaje espacial que decidirá el destino de la humanidad."),
    ("tt1049413", "Up: Una Aventura de Altura", "Animación / Aventura / Drama", 2009, "1h 36m", "9.0", "Un anciano viudo ata miles de globos a su casa para cumplir el sueño de su difunta esposa y viaja a Sudamérica."),
    ("tt0266543", "Buscando a Nemo", "Animación / Aventura / Submarino", 2003, "1h 40m", "9.0", "Un pez payaso temeroso emprende una odisea a través del océano para rescatar a su hijo capturado en la Gran Barrera de Coral."),
    ("tt0317219", "Cars: Una Aventura Sobre Ruedas", "Animación / Deportes / Comedia", 2006, "1h 57m", "8.7", "El engreído auto de carreras Rayo McQueen se pierde en Radiador Springs descubriendo el verdadero sentido de la amistad."),
    ("tt7510222", "Gru 4: Mi Villano Favorito", "Animación / Comedia / Familia", 2024, "1h 35m", "8.5", "Gru y Lucy dan la bienvenida a Gru Jr., pero deben huir cuando el peligroso Maxime Le Mal escapa de prisión."),
    ("tt3521164", "Vaiana (Moana)", "Animación / Aventura / Polinesia", 2016, "1h 47m", "8.8", "Una valiente joven polinesia zarpa a través del Pacífico con el semidiós Maui para devolver el corazón de Te Fiti."),
    ("tt4520988", "Frozen II", "Animación / Aventura / Musical", 2019, "1h 43m", "8.6", "Elsa, Anna, Kristoff y Olaf viajan al Bosque Encantado para descubrir el origen de los poderes de hielo de Elsa."),
    ("tt2386490", "Cómo Entrenar a tu Dragón 3", "Animación / Aventura / Fantasía", 2019, "1h 44m", "8.8", "Hipo y Chimuelo descubren el Mundo Oculto de dragones mientras una Furia Luminosa atrae el interés de Chimuelo."),
    ("tt3915174", "El Gato con Botas: El Último Deseo", "Animación / Aventura / Comedia", 2022, "1h 42m", "9.1", "El Gato con Botas descubre que su pasión por el peligro le ha costado ocho de sus nueve vidas y busca la Estrella de los Deseos."),
    ("tt0398286", "Enredados (Tangled)", "Animación / Comedia / Musical", 2010, "1h 40m", "8.8", "La princesa Rapunzel, encerrada en una torre oculta, escapa con el encantador bandido Flynn Rider para ver las linternas."),
    ("tt0198781", "Monstruos, S.A.", "Animación / Comedia / Amistad", 2001, "1h 32m", "8.9", "Los monstruos Sulley y Mike Wazowski descubren que los humanos no son tóxicos cuando una niña pequeña entra a su mundo.")
]

kids_list = []
for idx, k in enumerate(KIDS_SEED):
    imdb_id, title, genre, year, duration, rating, synopsis = k
    kids_list.append({
        'id': f'kid-{imdb_id}',
        'title': title,
        'genre': genre,
        'year': year,
        'duration': duration,
        'rating': rating,
        'quality': '4K UHD',
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'streamUrl': make_stream(idx)
    })

print(f"Total compiled Kids: {len(kids_list)}")

# 5. Expanded Documentaries (16 titles)
DOCS_SEED = [
    ("tt27814674", "Planeta Tierra III (Planet Earth III)", "Naturaleza & Biodiversidad", 2023, "1h 00m", "9.7", "David Attenborough narra las asombrosas adaptaciones de los animales en hábitats que cambian a un ritmo sin precedentes."),
    ("tt9253866", "Nuestro Planeta (Our Planet)", "Naturaleza & Cambio Climático", 2019, "50m", "9.5", "Una serie documental que muestra la belleza natural de la Tierra y el impacto del cambio climático en todas las criaturas vivas."),
    ("tt10626388", "Cosmos: Mundos Posibles", "Ciencia & Astrofísica", 2020, "52m", "9.4", "Neil deGrasse Tyson nos guía por reinos inexplorados y visiones futuristas de la humanidad entre las estrellas."),
    ("tt9656306", "Fórmula 1: Drive to Survive", "Deportes & Velocidad", 2024, "48m", "9.3", "Pilotos, directores de equipo y propietarios viven la vida al límite dentro y fuera de la pista durante el Campeonato Mundial."),
    ("tt8463324", "El Último Baile (The Last Dance)", "Deportes & Biografía / NBA", 2020, "50m", "9.8", "La crónica definitiva del ascenso de Michael Jordan y los Chicago Bulls en la década de 1990 con imágenes inéditas."),
    ("tt7775622", "Free Solo", "Aventura Extrema & Escalada", 2018, "1h 40m", "9.1", "Alex Honnold intenta escalar sin cuerdas la pared de roca vertical de 900 metros de El Capitán en el Parque Yosemite."),
    ("tt11464826", "El Dilema de las Redes Sociales", "Tecnología & Sociedad", 2020, "1h 34m", "8.9", "Expertos en Silicon Valley alertan sobre cómo el diseño de las redes sociales manipula el comportamiento y la salud mental."),
    ("tt8760684", "Apolo 11: La Misión a la Luna", "Historia & Exploración Espacial", 2019, "1h 33m", "9.3", "Una mirada íntima a la histórica misión del Apolo 11 en 1969 construida exclusivamente a partir de material de archivo en 70 mm."),
    ("tt0296310", "Planeta Azul II: Océanos Secretos", "Mundo Marino & Naturaleza", 2017, "1h 00m", "9.6", "Una exploración revolucionaria de los mares más profundos, arrecifes de coral y criaturas bioluminiscentes nunca vistas."),
    ("tt2061559", "Planeta de los Dinosaurios", "Paleontología & Prehistoria", 2011, "55m", "9.0", "Recreaciones por computadora de los depredadores más temibles que dominaron la Tierra hace más de 65 millones de años."),
    ("tt1504936", "La Segunda Guerra Mundial a Todo Color", "Historia Bélica & Archivo", 2009, "50m", "9.2", "Imágenes de combate restauradas y coloreadas que documentan las batallas clave que definieron la Segunda Guerra Mundial."),
    ("tt11152066", "Andes Mágicos", "Geografía & Culturas Andinas", 2021, "50m", "9.1", "Desde Argentina hasta Colombia, un recorrido visual por las vidas de quienes habitan la cordillera más larga del planeta."),
    ("tt4295150", "Chef's Table: Leyendas Culinarias", "Gastronomía & Cultura", 2020, "50m", "9.0", "Perfiles cinematográficos de los chefs más innovadores del mundo que están redefiniendo el arte culinario."),
    ("tt14079374", "14 Picos: Nada es Imposible", "Montañismo Extremo & Superación", 2021, "1h 41m", "9.2", "El intrépido alpinista nepalí Nimsdai Purja se propone escalar los 14 ochomiles del mundo en apenas siete meses."),
    ("tt12888462", "Mi Maestro el Pulpo", "Naturaleza & Conexión Animal", 2020, "1h 25m", "9.1", "Un cineasta forja una improbable amistad con un pulpo que vive en un bosque de algas marinas en Sudáfrica."),
    ("tt6265004", "Imperio Romano: Reinado de Sangre", "Historia Antigua & Roma", 2019, "48m", "8.9", "Docudrama histórico que combina análisis de historiadores con recreaciones dramáticas de las vidas de Cómodo, Julio César y Calígula.")
]

docs_list = []
for idx, d in enumerate(DOCS_SEED):
    imdb_id, title, genre, year, duration, rating, synopsis = d
    docs_list.append({
        'id': f'doc-{imdb_id}',
        'title': title,
        'genre': genre,
        'year': year,
        'duration': duration,
        'rating': rating,
        'quality': '1080p HD',
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'streamUrl': make_stream(idx)
    })

print(f"Total compiled Docs: {len(docs_list)}")

# 6. Expanded Music & Concerts (14 titles)
MUSIC_SEED = [
    ("tt0170465", "Queen: Live at Wembley Stadium & Live Aid", "Queen", "Rock Clásico", "1h 50m", "9.8", "La legendaria actuación de Freddie Mercury y Queen en el estadio de Wembley en 1986 con audio remasterizado en alta fidelidad."),
    ("tt22074358", "Coldplay: Music of the Spheres (Live in River Plate)", "Coldplay", "Pop Rock Alternativo", "2h 10m", "9.6", "Transmisión histórica de la gira mundial Music of the Spheres desde el estadio River Plate con espectáculos de luces estelares."),
    ("tt28814949", "Taylor Swift: The Eras Tour", "Taylor Swift", "Pop / Concierto Estadio", "2h 45m", "9.5", "El fenómeno cultural que recorre las 10 eras musicales de la carrera de Taylor Swift grabado en el SoFi Stadium de Los Ángeles."),
    ("tt10787408", "Metallica and San Francisco Symphony: S&M2", "Metallica & Orquesta", "Heavy Metal Sinfónico", "2h 30m", "9.6", "Celebración del 20 aniversario del histórico álbum S&M con la Orquesta Sinfónica de San Francisco."),
    ("tt0388295", "Nirvana: MTV Unplugged in New York", "Nirvana", "Grunge Acústico", "1h 06m", "9.7", "La actuación acústica más trascendente de la historia del rock protagonizada por Kurt Cobain en los estudios de Sony Music."),
    ("tt1924198", "AC/DC: Live at River Plate", "AC/DC", "Hard Rock", "1h 50m", "9.7", "Grabado en Buenos Aires ante más de 200.000 fanáticos con un despliegue arrollador de energía y clásicos del rock."),
    ("tt0130985", "Pink Floyd: Pulse Live in London", "Pink Floyd", "Rock Progresivo", "2h 25m", "9.8", "Grabado durante la gira The Division Bell en 1994, incluye la interpretación completa de The Dark Side of the Moon."),
    ("tt0383478", "Michael Jackson: Live in Bucharest (Dangerous Tour)", "Michael Jackson", "Pop / R&B", "2h 02m", "9.7", "El concierto cumbre del Rey del Pop ante 70.000 espectadores con coreografías y efectos pirotécnicos históricos."),
    ("tt7347104", "Hans Zimmer: Live in Prague", "Hans Zimmer & Orquesta", "Bandas Sonoras Épicas", "2h 18m", "9.8", "El legendario compositor interpreta las partituras de Gladiador, Interestelar, El Caballero de la Noche y El Rey León."),
    ("tt0368667", "Daft Punk: Interstella 5555", "Daft Punk & Leiji Matsumoto", "Electrónica / House", "1h 05m", "9.4", "La ópera espacial animada que musicaliza íntegramente el aclamado álbum Discovery de Daft Punk."),
    ("tt24177568", "Billie Eilish: Live at the O2", "Billie Eilish", "Pop Alternativo / Indie", "1h 35m", "9.2", "Concierto visual electrizante en Londres interpretando los éxitos de Happier Than Ever con puesta en escena inmersiva."),
    ("tt9735462", "The Beatles: Get Back (Rooftop Concert)", "The Beatles", "Rock Clásico", "1h 05m", "9.8", "La mítica última actuación en vivo de The Beatles en la azotea de Apple Corps en Savile Row, Londres."),
    ("tt23758362", "Elton John: Farewell Yellow Brick Road", "Elton John", "Pop / Glam Rock", "2h 45m", "9.4", "El concierto de despedida definitivo transmitido en vivo desde el Dodger Stadium de Los Ángeles con invitados especiales."),
    ("tt10107290", "Beyoncé: Homecoming (Live at Coachella)", "Beyoncé", "R&B / Pop / Urban", "2h 17m", "9.5", "La histórica presentación en Coachella 2018 que rindió homenaje a las universidades y colegios históricamente negros de EE.UU.")
]

music_list = []
for idx, m in enumerate(MUSIC_SEED):
    imdb_id, title, artist, genre, duration, rating, synopsis = m
    music_list.append({
        'id': f'mus-{imdb_id}',
        'title': title,
        'artist': artist,
        'genre': genre,
        'duration': duration,
        'rating': rating,
        'quality': '1080p HD',
        'poster': make_poster(imdb_id),
        'backdrop': make_backdrop(imdb_id),
        'synopsis': synopsis,
        'streamUrl': make_stream(idx)
    })

print(f"Total compiled Music: {len(music_list)}")

# 7. Expanded Sports Matches (12 events)
SPORTS_SEED = [
    ("match-1", "LaLiga EA Sports", "Real Madrid vs FC Barcelona - El Clásico", "Real Madrid vs FC Barcelona", "21:00 CEST", "Hoy", "live", "2 - 1", "ch-4", "Teledeporte RTVE HD", "Estadio Santiago Bernabéu"),
    ("match-2", "UEFA Champions League", "Manchester City vs Real Madrid", "Man City vs Real Madrid", "20:45 CEST", "Mañana", "upcoming", "vs", "ch-1", "La 1 HD Directo", "Etihad Stadium"),
    ("match-3", "Fórmula 1", "Gran Premio de España - Carrera Principal", "F1 GP Montmeló", "15:00 CEST", "Domingo", "upcoming", "F1 Live", "ch-4", "Teledeporte RTVE HD", "Circuit de Barcelona-Catalunya"),
    ("match-4", "MotoGP", "Gran Premio de España - Jerez", "MotoGP Carrera", "14:00 CEST", "Domingo", "upcoming", "MotoGP", "ch-4", "Teledeporte RTVE HD", "Circuito de Jerez"),
    ("match-5", "NBA Finals", "Boston Celtics vs Los Angeles Lakers", "Celtics vs Lakers", "02:30 CEST", "Viernes", "upcoming", "104 - 101", "ch-4", "Teledeporte RTVE HD", "TD Garden"),
    ("match-6", "Roland Garros Final", "Carlos Alcaraz vs Jannik Sinner", "Alcaraz vs Sinner", "15:00 CEST", "Domingo", "upcoming", "6-4, 7-6", "ch-1", "La 1 HD Directo", "Court Philippe-Chatrier"),
    ("match-7", "Premier League", "Arsenal vs Liverpool", "Arsenal vs Liverpool", "17:30 CEST", "Sábado", "upcoming", "vs", "ch-4", "Teledeporte RTVE HD", "Emirates Stadium"),
    ("match-8", "UFC 315", "Campeonato Mundial Peso Ligero", "Makhachev vs Volkanovski", "04:00 CEST", "Domingo", "upcoming", "Ronda 5", "ch-4", "Teledeporte RTVE HD", "T-Mobile Arena"),
    ("match-9", "Copa del Rey", "Athletic Club vs Real Sociedad - Derbi Vasco", "Athletic vs Real Sociedad", "21:30 CEST", "Miércoles", "upcoming", "vs", "ch-1", "La 1 HD Directo", "Estadio San Mamés"),
    ("match-10", "NFL Super Bowl", "Kansas City Chiefs vs San Francisco 49ers", "Chiefs vs 49ers", "00:30 CEST", "Domingo", "upcoming", "25 - 22", "ch-4", "Teledeporte RTVE HD", "Allegiant Stadium"),
    ("match-11", "Tour de Francia", "Etapa 14: Pirineos - Tourmalet", "Pelotón Tour de Francia", "12:00 CEST", "Sábado", "upcoming", "Etapa Reina", "ch-4", "Teledeporte RTVE HD", "Col du Tourmalet"),
    ("match-12", "ATP Masters 1000 Madrid", "Final Masculina Mutua Madrid Open", "Finalistas Madrid Open", "18:30 CEST", "Domingo", "upcoming", "vs", "ch-1", "La 1 HD Directo", "Caja Mágica")
]

matches_list = []
for m in SPORTS_SEED:
    mid, league, title, teams, time, date, status, score, ch_id, ch_name, stadium = m
    matches_list.append({
        'id': mid,
        'league': league,
        'title': title,
        'teams': teams,
        'poster': 'assets/backdrop.png',
        'time': time,
        'date': date,
        'status': status,
        'score': score,
        'channelId': ch_id,
        'channelName': ch_name,
        'stadium': stadium
    })

print(f"Total compiled Sports: {len(matches_list)}")

# 8. Output full src/data.js
output_js = f"""// SwordTV Content Database - Spanish & Latin America Curated IPTV & VOD
// Motor y Estilo Sword Wallpaper (Aura) - Listas Completas de Todo el Ecosistema

export const CATEGORIES = [
  // Fila 1
  {{ id: 'live', name: 'En Vivo', icon: '📺', row: 1 }},
  {{ id: 'movies', name: 'Películas', icon: '🎬', row: 1 }},
  {{ id: 'series', name: 'Series', icon: '🍿', row: 1 }},
  {{ id: 'anime', name: 'Anime', icon: '⛩️', row: 1 }},
  {{ id: 'kids', name: 'Infantil', icon: '👶', row: 1 }},
  // Fila 2
  {{ id: 'sports', name: 'Deportes', icon: '⚽', row: 2 }},
  {{ id: 'music', name: 'Música', icon: '🎵', row: 2 }},
  {{ id: 'docs', name: 'Documentales', icon: '📚', row: 2 }},
  {{ id: 'favorites', name: 'Favoritos', icon: '⭐', row: 2 }},
  {{ id: 'settings', name: 'Configuración', icon: '⚙️', row: 2 }},
];

export const LIVE_SUBCATEGORIES = [
  {{ id: 'all', name: 'Todos los Canales' }},
  {{ id: 'favs', name: '⭐ Favoritos' }},
  {{ id: 'noticias', name: 'Noticias' }},
  {{ id: 'deportes', name: 'Deportes' }},
  {{ id: 'cine', name: 'Cine & Series' }},
  {{ id: 'entretenimiento', name: 'Entretenimiento' }},
  {{ id: 'infantil', name: 'Infantil' }},
  {{ id: 'anime', name: 'Anime 24/7' }},
  {{ id: 'musica', name: 'Música' }},
  {{ id: 'cultura', name: 'Cultura & Ciencia' }},
  {{ id: 'adultos', name: 'Adultos (+18)' }},
];

export const CHANNELS = {json.dumps(all_channels, indent=2, ensure_ascii=False)};

export const MOVIES = {json.dumps(movies_list, indent=2, ensure_ascii=False)};

export const SERIES = {json.dumps(series_list, indent=2, ensure_ascii=False)};

export const ANIME = {json.dumps(anime_list, indent=2, ensure_ascii=False)};

export const KIDS = {json.dumps(kids_list, indent=2, ensure_ascii=False)};

export const MUSIC_ITEMS = {json.dumps(music_list, indent=2, ensure_ascii=False)};

export const DOCS_ITEMS = {json.dumps(docs_list, indent=2, ensure_ascii=False)};

export const SPORTS_MATCHES = {json.dumps(matches_list, indent=2, ensure_ascii=False)};
"""

with open('src/data.js', 'w', encoding='utf-8') as f:
    f.write(output_js)

print("src/data.js successfully written!")
