#!/usr/bin/env python3
import json
import re
import os
import urllib.request
import time

print("Starting generation of expanded catalogs...")

# Fetch from Cinemeta
def fetch_cinemeta(type_, genre=None):
    url = f"https://v3-cinemeta.strem.io/catalog/{type_}/top"
    if genre:
        url += f"/genre={genre}"
    url += ".json"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read()).get('metas', [])
    except Exception as e:
        print(f"Fetch warning for {url}: {e}")
        return []

# 1. MOVIES (180+)
print("Gathering Movies...")
raw_movies = []
raw_movies.extend(fetch_cinemeta('movie'))
for g in ['Action', 'Sci-Fi', 'Animation', 'Drama', 'Comedy', 'Horror', 'Adventure', 'Thriller', 'Crime', 'Fantasy']:
    raw_movies.extend(fetch_cinemeta('movie', g))
    time.sleep(0.1)

seen_m_ids = set()
movies_list = []

# Essential classics and top blockbusters
CURATED_MOVIES = [
    {"id": "tt15239678", "title": "Dune: Parte Dos", "genre": "Ciencia Ficción • Aventura", "year": "2024", "duration": "2h 46m", "rating": "8.6", "quality": "4K Ultra HD", "synopsis": "Paul Atreides se une a Chani y a los Fremen mientras busca venganza contra los conspiradores que destruyeron a su familia.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "tt15398776", "title": "Oppenheimer", "genre": "Drama • Historia", "year": "2023", "duration": "3h 00m", "rating": "8.9", "quality": "4K Ultra HD", "synopsis": "La historia del físico J. Robert Oppenheimer y su rol en el Proyecto Manhattan durante la Segunda Guerra Mundial.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "tt0816692", "title": "Interestelar (Interstellar)", "genre": "Ciencia Ficción • Drama", "year": "2014", "duration": "2h 49m", "rating": "8.7", "quality": "4K Ultra HD", "synopsis": "Un equipo de exploradores viaja a través de un agujero de gusano en el espacio en un intento por asegurar la supervivencia de la humanidad.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "tt1375666", "title": "El Origen (Inception)", "genre": "Ciencia Ficción • Acción", "year": "2010", "duration": "2h 28m", "rating": "8.8", "quality": "4K Ultra HD", "synopsis": "Un ladrón con la habilidad de entrar en los sueños de las personas recibe una oportunidad de borrar su historial criminal.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "tt0133093", "title": "Matrix (The Matrix)", "genre": "Ciencia Ficción • Acción", "year": "1999", "duration": "2h 16m", "rating": "8.7", "quality": "4K Ultra HD", "synopsis": "Un programador informático descubre una verdad impactante sobre su realidad y su papel en la guerra contra sus controladores.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "tt0468569", "title": "Batman: El Caballero de la Noche", "genre": "Acción • Crimen", "year": "2008", "duration": "2h 32m", "rating": "9.0", "quality": "4K Ultra HD", "synopsis": "Batman debe aceptar una de las pruebas psicológicas y físicas más grandes de su capacidad para luchar contra la injusticia.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "tt4154796", "title": "Avengers: Endgame", "genre": "Acción • Aventura", "year": "2019", "duration": "3h 01m", "rating": "8.4", "quality": "4K Ultra HD", "synopsis": "Después de los devastadores eventos de Infinity War, el universo está en ruinas con la ayuda de los aliados restantes.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"},
    {"id": "tt9362722", "title": "Spider-Man: A Través del Spider-Verso", "genre": "Animación • Acción", "year": "2023", "duration": "2h 20m", "rating": "8.7", "quality": "4K Ultra HD", "synopsis": "Miles Morales es catapultado a través del Multiverso, donde se encuentra con un equipo de Spider-People.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"},
    {"id": "tt0111161", "title": "Sueños de Fuga (The Shawshank Redemption)", "genre": "Drama", "year": "1994", "duration": "2h 22m", "rating": "9.3", "quality": "4K Ultra HD", "synopsis": "Dos hombres encarcelados forjan una amistad a lo largo de los años, encontrando consuelo y redención eventual.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "tt0068646", "title": "El Padrino (The Godfather)", "genre": "Crimen • Drama", "year": "1972", "duration": "2h 55m", "rating": "9.2", "quality": "4K Ultra HD", "synopsis": "El patriarca que envejece de una dinastía del crimen organizado transfiere el control de su imperio clandestino a su hijo reacio.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "tt0110912", "title": "Pulp Fiction (Tiempos Violentos)", "genre": "Crimen • Drama", "year": "1994", "duration": "2h 34m", "rating": "8.9", "quality": "4K Ultra HD", "synopsis": "Las vidas de dos sicarios de la mafia, un boxeador, la esposa de un gángster y dos bandidos se entrelazan en cuatro historias de violencia.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "tt0172495", "title": "Gladiador (Gladiator)", "genre": "Acción • Aventura", "year": "2000", "duration": "2h 35m", "rating": "8.5", "quality": "4K Ultra HD", "synopsis": "Un antiguo general romano se propone exigir venganza contra el corrupto emperador que asesinó a su familia y lo envió a la esclavitud.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "tt6751668", "title": "Parásitos (Parasite)", "genre": "Drama • Suspenso", "year": "2019", "duration": "2h 12m", "rating": "8.5", "quality": "4K Ultra HD", "synopsis": "La codicia y la discriminación de clases amenazan la relación recién formada entre la adinerada familia Park y el empobrecido clan Kim.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "tt10366206", "title": "John Wick 4", "genre": "Acción • Crimen", "year": "2023", "duration": "2h 49m", "rating": "7.7", "quality": "4K Ultra HD", "synopsis": "John Wick descubre un camino para derrotar a la Alta Mesa, pero antes debe enfrentarse a un nuevo enemigo con poderosas alianzas.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "tt1745960", "title": "Top Gun: Maverick", "genre": "Acción • Drama", "year": "2022", "duration": "2h 10m", "rating": "8.3", "quality": "4K Ultra HD", "synopsis": "Después de más de treinta años de servicio como uno de los mejores aviadores de la Armada, Pete 'Maverick' Mitchell se encuentra entrenando a graduados.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"},
    {"id": "tt1630029", "title": "Avatar: El Camino del Agua", "genre": "Ciencia Ficción • Aventura", "year": "2022", "duration": "3h 12m", "rating": "7.6", "quality": "4K Ultra HD", "synopsis": "Jake Sully vive con su nueva familia en el planeta Pandora. Una amenaza conocida regresa para terminar lo que empezó.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"},
    {"id": "tt0137523", "title": "El Club de la Pelea (Fight Club)", "genre": "Drama", "year": "1999", "duration": "2h 19m", "rating": "8.8", "quality": "4K Ultra HD", "synopsis": "Un oficinista insomne y un fabricante de jabón desentendido forman un club de lucha clandestino.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "tt7286456", "title": "Joker", "genre": "Crimen • Drama", "year": "2019", "duration": "2h 02m", "rating": "8.4", "quality": "4K Ultra HD", "synopsis": "En Gotham City, el comediante Arthur Fleck, con problemas mentales, es marginado y maltratado por la sociedad.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "tt0109830", "title": "Forrest Gump", "genre": "Drama • Romance", "year": "1994", "duration": "2h 22m", "rating": "8.8", "quality": "4K Ultra HD", "synopsis": "Las presidencias de Kennedy y Johnson, los eventos de Vietnam y otros eventos históricos se desarrollan a través de la perspectiva de un hombre de Alabama.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "tt0099685", "title": "Buenos Muchachos (GoodFellas)", "genre": "Biografía • Crimen", "year": "1990", "duration": "2h 25m", "rating": "8.7", "quality": "4K Ultra HD", "synopsis": "La historia de Henry Hill y su vida en la mafia, cubriendo su relación con su esposa Karen Hill y sus socios de la mafia Jimmy Conway y Tommy DeVito.", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"}
]

for m in CURATED_MOVIES:
    mid = m["id"]
    seen_m_ids.add(mid)
    movies_list.append({
        "id": mid,
        "title": m["title"],
        "genre": m["genre"],
        "year": m["year"],
        "duration": m["duration"],
        "rating": m["rating"],
        "quality": m["quality"],
        "synopsis": m["synopsis"],
        "poster": f"https://images.metahub.space/poster/small/{mid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{mid}/img",
        "streamUrl": m["streamUrl"]
    })

vod_fallback_urls = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"
]

for m in raw_movies:
    mid = m.get('id') or m.get('imdb_id')
    if not mid or mid in seen_m_ids:
        continue
    name = m.get('name', '').strip()
    if not name or len(name) < 2:
        continue
    genres = m.get('genres', []) or m.get('genre', [])
    genre_str = " • ".join(genres[:2]) if genres else "Película HD"
    rating = str(m.get('imdbRating') or '7.5')
    year = str(m.get('year') or m.get('releaseInfo') or '2023')
    synopsis = m.get('description') or f"Película completa en calidad de alta definición con audio en español y subtítulos."
    duration = m.get('runtime') or "1h 55m"
    stream_url = vod_fallback_urls[len(movies_list) % len(vod_fallback_urls)]
    
    movies_list.append({
        "id": mid,
        "title": name,
        "genre": genre_str,
        "year": year,
        "duration": duration,
        "rating": rating,
        "quality": "4K Ultra HD" if float(rating if rating.replace('.', '', 1).isdigit() else 7.5) >= 8.0 else "1080p HD",
        "synopsis": synopsis,
        "poster": f"https://images.metahub.space/poster/small/{mid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{mid}/img",
        "streamUrl": stream_url
    })
    seen_m_ids.add(mid)
    if len(movies_list) >= 185:
        break

print(f"Total Movies prepared: {len(movies_list)}")

# 2. SERIES (80+)
print("Gathering Series...")
raw_series = []
raw_series.extend(fetch_cinemeta('series'))
for g in ['Drama', 'Action', 'Sci-Fi', 'Comedy', 'Mystery', 'Animation']:
    raw_series.extend(fetch_cinemeta('series', g))
    time.sleep(0.1)

seen_s_ids = set()
series_list = []

CURATED_SERIES = [
    {"id": "tt0903747", "title": "Breaking Bad", "genre": "Crimen • Drama • Suspenso", "year": "2008-2013", "rating": "9.5", "seasons": 5, "eps_per_season": 13, "synopsis": "Un profesor de química de secundaria diagnosticado con cáncer de pulmón inoperable se asocia con un exalumno para fabricar metanfetamina."},
    {"id": "tt3032476", "title": "Better Call Saul", "genre": "Crimen • Drama", "year": "2015-2022", "rating": "9.0", "seasons": 6, "eps_per_season": 10, "synopsis": "Las pruebas y tribulaciones del abogado criminalista Jimmy McGill antes de su fatídica asociación con Walter White."},
    {"id": "tt0944947", "title": "Game of Thrones (Juego de Tronos)", "genre": "Fantasía • Drama • Acción", "year": "2011-2019", "rating": "9.2", "seasons": 8, "eps_per_season": 10, "synopsis": "Nueve familias nobles luchan por el control sobre las tierras míticas de Poniente, mientras un antiguo enemigo regresa."},
    {"id": "tt11198330", "title": "House of the Dragon (La Casa del Dragón)", "genre": "Fantasía • Drama", "year": "2022-", "rating": "8.5", "seasons": 2, "eps_per_season": 8, "synopsis": "La historia interna de la Casa Targaryen ambientada 200 años antes de los eventos de Game of Thrones."},
    {"id": "tt1190634", "title": "The Boys", "genre": "Acción • Comedia • Ciencia Ficción", "year": "2019-", "rating": "8.7", "seasons": 4, "eps_per_season": 8, "synopsis": "Un grupo de vigilantes se propone acabar con los superhéroes corruptos que abusan de sus superpoderes."},
    {"id": "tt3581920", "title": "The Last of Us", "genre": "Drama • Ciencia Ficción • Aventura", "year": "2023-", "rating": "8.8", "seasons": 1, "eps_per_season": 9, "synopsis": "Tras una pandemia global que destruye la civilización, un sobreviviente endurecido se hace cargo de una niña de 14 años."},
    {"id": "tt4574334", "title": "Stranger Things", "genre": "Ciencia Ficción • Terror • Drama", "year": "2016-", "rating": "8.7", "seasons": 4, "eps_per_season": 9, "synopsis": "Cuando un niño desaparece, su madre, un jefe de policía y sus amigos deben enfrentarse a fuerzas sobrenaturales terroríficas."},
    {"id": "tt11280740", "title": "Severance", "genre": "Ciencia Ficción • Suspenso", "year": "2022-", "rating": "8.7", "seasons": 2, "eps_per_season": 9, "synopsis": "Mark lidera un equipo de oficinistas cuyos recuerdos han sido divididos quirúrgicamente entre su trabajo y su vida personal."},
    {"id": "tt12637874", "title": "Fallout", "genre": "Ciencia Ficción • Aventura • Acción", "year": "2024-", "rating": "8.4", "seasons": 1, "eps_per_season": 8, "synopsis": "En un futuro post-apocalíptico de Los Ángeles, los ciudadanos deben vivir en búnkeres subterráneos para protegerse de la radiación."},
    {"id": "tt2788316", "title": "Shōgun", "genre": "Drama • Historia • Aventura", "year": "2024-", "rating": "8.7", "seasons": 1, "eps_per_season": 10, "synopsis": "Cuando un misterioso barco europeo es encontrado desamparado en un pueblo pesquero japonés cercano, su patrón inglés guarda secretos."},
    {"id": "tt9140554", "title": "Loki", "genre": "Acción • Ciencia Ficción • Fantasía", "year": "2021-2023", "rating": "8.2", "seasons": 2, "eps_per_season": 6, "synopsis": "El voluble villano Loki retoma su papel como el Dios de la Travesura en una serie que tiene lugar tras Avengers: Endgame."},
    {"id": "tt7660850", "title": "Succession", "genre": "Drama", "year": "2018-2023", "rating": "8.9", "seasons": 4, "eps_per_season": 10, "synopsis": "La familia Roy es conocida por controlar Waystar RoyCo, uno de los conglomerados de medios y entretenimiento más grandes del mundo."},
    {"id": "tt14452776", "title": "The Bear", "genre": "Comedia • Drama", "year": "2022-", "rating": "8.6", "seasons": 3, "eps_per_season": 10, "synopsis": "Un joven chef de alta cocina regresa a Chicago para dirigir la tienda de sándwiches de carne italiana de su familia."},
    {"id": "tt2442560", "title": "Peaky Blinders", "genre": "Crimen • Drama", "year": "2013-2022", "rating": "8.8", "seasons": 6, "eps_per_season": 6, "synopsis": "Una pandilla criminal con sede en Birmingham, Inglaterra, en 1919, liderada por el feroz Tommy Shelby."},
    {"id": "tt8273064", "title": "Chernobyl", "genre": "Drama • Historia • Suspenso", "year": "2019", "rating": "9.4", "seasons": 1, "eps_per_season": 5, "synopsis": "En abril de 1986, una explosión masiva sacude la planta de energía nuclear de Chernobyl en la Unión Soviética."},
    {"id": "tt11126994", "title": "Arcane", "genre": "Animación • Acción • Ciencia Ficción", "year": "2021-2024", "rating": "9.0", "seasons": 2, "eps_per_season": 9, "synopsis": "En las ciudades gemelas de Piltover y Zaun, dos hermanas luchan en lados opuestos de una guerra de tecnologías mágicas."},
    {"id": "tt0141842", "title": "Los Soprano (The Sopranos)", "genre": "Crimen • Drama", "year": "1999-2007", "rating": "9.2", "seasons": 6, "eps_per_season": 13, "synopsis": "El jefe de la mafia de Nueva Jersey, Tony Soprano, lidia con problemas personales y profesionales que afectan su salud mental."},
    {"id": "tt0306414", "title": "The Wire (Bajo Escucha)", "genre": "Crimen • Drama • Suspenso", "year": "2002-2008", "rating": "9.3", "seasons": 5, "eps_per_season": 12, "synopsis": "La escena del narcotráfico de Baltimore vista a través de los ojos de los traficantes de drogas y las fuerzas del orden."},
    {"id": "tt5753856", "title": "Dark", "genre": "Crimen • Drama • Misterio", "year": "2017-2020", "rating": "8.7", "seasons": 3, "eps_per_season": 8, "synopsis": "La desaparición de dos niños en la ciudad alemana de Winden saca a la luz las relaciones fracturadas entre cuatro familias."},
    {"id": "tt2085059", "title": "Black Mirror", "genre": "Drama • Ciencia Ficción • Suspenso", "year": "2011-", "rating": "8.7", "seasons": 6, "eps_per_season": 5, "synopsis": "Una serie de antología que explora un multiverso retorcido y de alta tecnología donde las mayores innovaciones de la humanidad chocan."}
]

def make_episodes(parent_id, parent_title, seasons_count, eps_per_s):
    season_list = []
    for s in range(1, seasons_count + 1):
        episodes = []
        for e in range(1, eps_per_s + 1):
            ep_url = vod_fallback_urls[(s * 7 + e) % len(vod_fallback_urls)]
            episodes.append({
                "epNum": e,
                "title": f"Episodio {e}",
                "duration": "48m",
                "streamUrl": ep_url,
                "synopsis": f"Capítulo {e} de la Temporada {s} de {parent_title} con audio original en español latino y castellano HD."
            })
        season_list.append({
            "season": s,
            "title": f"Temporada {s}",
            "episodes": episodes
        })
    return season_list

for s in CURATED_SERIES:
    sid = s["id"]
    seen_s_ids.add(sid)
    seasons = make_episodes(sid, s["title"], s["seasons"], s["eps_per_season"])
    series_list.append({
        "id": sid,
        "title": s["title"],
        "genre": s["genre"],
        "year": s["year"],
        "rating": s["rating"],
        "quality": "4K Ultra HD",
        "synopsis": s["synopsis"],
        "poster": f"https://images.metahub.space/poster/small/{sid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{sid}/img",
        "seasons": s["seasons"],
        "streamUrl": seasons[0]["episodes"][0]["streamUrl"],
        "seasonList": seasons
    })

for s in raw_series:
    sid = s.get('id') or s.get('imdb_id')
    if not sid or sid in seen_s_ids:
        continue
    name = s.get('name', '').strip()
    if not name or len(name) < 2:
        continue
    genres = s.get('genres', []) or s.get('genre', [])
    genre_str = " • ".join(genres[:2]) if genres else "Serie HD"
    rating = str(s.get('imdbRating') or '7.8')
    year = str(s.get('year') or s.get('releaseInfo') or '2023')
    synopsis = s.get('description') or f"Serie completa en alta definición con todas sus temporadas y capítulos en español."
    seasons = make_episodes(sid, name, 3, 10)
    
    series_list.append({
        "id": sid,
        "title": name,
        "genre": genre_str,
        "year": year,
        "rating": rating,
        "quality": "4K Ultra HD" if float(rating if rating.replace('.', '', 1).isdigit() else 7.5) >= 8.0 else "1080p HD",
        "synopsis": synopsis,
        "poster": f"https://images.metahub.space/poster/small/{sid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{sid}/img",
        "seasons": 3,
        "streamUrl": seasons[0]["episodes"][0]["streamUrl"],
        "seasonList": seasons
    })
    seen_s_ids.add(sid)
    if len(series_list) >= 85:
        break

print(f"Total Series prepared: {len(series_list)}")

# 3. ANIME (75+)
print("Gathering Anime...")
CURATED_ANIME = [
    {"id": "tt4644488", "title": "Dragon Ball Super", "genre": "Shonen • Acción • Aventura", "year": "2015-2018", "rating": "8.3", "eps": 26, "synopsis": "Goku y Vegeta enfrentan a los dioses de la destrucción y guerreros de todos los universos en el Torneo del Poder."},
    {"id": "tt0280249", "title": "Dragon Ball Z", "genre": "Shonen • Acción • Clásico", "year": "1989-1996", "rating": "8.8", "eps": 26, "synopsis": "Goku descubre su origen Saiyajin y defiende la Tierra de Freezer, Cell, Majin Boo y guerreros del espacio."},
    {"id": "tt0409591", "title": "Naruto", "genre": "Shonen • Ninja • Aventura", "year": "2002-2007", "rating": "8.4", "eps": 26, "synopsis": "Un joven ninja marginado sueña con convertirse en el líder de su aldea mientras supera duras batallas y rivales."},
    {"id": "tt0988824", "title": "Naruto Shippuden", "genre": "Shonen • Ninja • Acción", "year": "2007-2017", "rating": "8.7", "eps": 26, "synopsis": "Naruto regresa más fuerte para rescatar a Sasuke y salvar el mundo shinobi de la organización Akatsuki."},
    {"id": "tt0388629", "title": "One Piece", "genre": "Shonen • Piratas • Aventura", "year": "1999-", "rating": "9.0", "eps": 30, "synopsis": "Monkey D. Luffy y los Sombrero de Paja navegan los mares del Grand Line en busca del legendario tesoro One Piece."},
    {"id": "tt2560140", "title": "Attack on Titan (Shingeki no Kyojin)", "genre": "Acción • Drama • Fantasía", "year": "2013-2023", "rating": "9.1", "eps": 26, "synopsis": "La humanidad lucha por sobrevivir detrás de inmensos muros contra gigantescos titanes devoradores de humanos."},
    {"id": "tt0877057", "title": "Death Note", "genre": "Suspenso • Misterio • Sobrenatural", "year": "2006-2007", "rating": "9.0", "eps": 26, "synopsis": "Un estudiante de secundaria brillante encuentra un cuaderno que le permite matar a cualquiera con solo escribir su nombre."},
    {"id": "tt12343534", "title": "Jujutsu Kaisen", "genre": "Shonen • Acción • Sobrenatural", "year": "2020-", "rating": "8.6", "eps": 24, "synopsis": "Yuji Itadori se une a una escuela secreta de hechiceros tras consumir un dedo maldito del temible Sukuna."},
    {"id": "tt9335498", "title": "Demon Slayer: Kimetsu no Yaiba", "genre": "Shonen • Acción • Fantasía", "year": "2019-", "rating": "8.6", "eps": 26, "synopsis": "Tanjiro Kamado entrena como cazador de demonios para vengar a su familia y curar a su hermana Nezuko."},
    {"id": "tt21209876", "title": "Solo Leveling", "genre": "Acción • Fantasía • Isekai", "year": "2024-", "rating": "8.5", "eps": 12, "synopsis": "Sung Jinwoo, conocido como el cazador más débil, obtiene un misterioso sistema que le permite subir de nivel sin límite."},
    {"id": "tt22248376", "title": "Frieren: Beyond Journey's End", "genre": "Fantasía • Aventura • Drama", "year": "2023-2024", "rating": "8.9", "eps": 28, "synopsis": "La maga elfa Frieren reflexiona sobre el significado del tiempo y la amistad tras derrotar al Rey Demonio."},
    {"id": "tt13616990", "title": "Chainsaw Man", "genre": "Acción • Terror • Sobrenatural", "year": "2022-", "rating": "8.4", "eps": 12, "synopsis": "Denji se fusiona con su perro demonio Pochita para convertirse en Chainsaw Man y cazar demonios para Seguridad Pública."},
    {"id": "tt5626028", "title": "My Hero Academia (Boku no Hero)", "genre": "Shonen • Superhéroes • Acción", "year": "2016-", "rating": "8.2", "eps": 25, "synopsis": "Izuku Midoriya hereda el poder de All Might y asiste a la prestigiosa escuela de héroes UA."},
    {"id": "tt2098220", "title": "Hunter x Hunter (2011)", "genre": "Shonen • Aventura • Acción", "year": "2011-2014", "rating": "9.0", "eps": 26, "synopsis": "Gon Freecss se propone convertirse en Cazador para encontrar a su padre ausente, Ging Freecss."},
    {"id": "tt0434665", "title": "Bleach", "genre": "Shonen • Acción • Sobrenatural", "year": "2004-2012", "rating": "8.2", "eps": 26, "synopsis": "Ichigo Kurosaki obtiene los poderes de un Shinigami y defiende a los humanos de espíritus malignos llamados Hollows."},
    {"id": "tt1453405", "title": "Fullmetal Alchemist: Brotherhood", "genre": "Acción • Aventura • Fantasía", "year": "2009-2010", "rating": "9.1", "eps": 26, "synopsis": "Dos hermanos usan la alquimia para buscar la Piedra Filosofal y restaurar sus cuerpos tras un fallido ritual."},
    {"id": "tt1910272", "title": "Steins;Gate", "genre": "Ciencia Ficción • Suspenso", "year": "2011", "rating": "8.8", "eps": 24, "synopsis": "Un grupo de amigos en Akihabara descubre cómo enviar mensajes de texto al pasado con un microondas modificado."},
    {"id": "tt3790518", "title": "Tokyo Ghoul", "genre": "Acción • Terror • Sobrenatural", "year": "2014-2018", "rating": "7.8", "eps": 24, "synopsis": "Un tímido estudiante se convierte en mitad ghoul tras sobrevivir a un encuentro fatal con una de estas criaturas carnívoras."},
    {"id": "tt0213338", "title": "Cowboy Bebop", "genre": "Ciencia Ficción • Acción • Aventura", "year": "1998-1999", "rating": "8.9", "eps": 26, "synopsis": "Un grupo de cazarrecompensas espaciales viaja a bordo de la nave Bebop en el año 2071 persiguiendo fugitivos."},
    {"id": "tt0112159", "title": "Neon Genesis Evangelion", "genre": "Mecha • Ciencia Ficción • Drama", "year": "1995-1996", "rating": "8.5", "eps": 26, "synopsis": "Jóvenes pilotos controlan bio-máquinas gigantes llamadas Evangelion para proteger a la Tierra de misteriosos Ángeles."},
    {"id": "tt10233444", "title": "Vinland Saga", "genre": "Acción • Aventura • Drama", "year": "2019-", "rating": "8.8", "eps": 24, "synopsis": "El joven vikingo Thorfinn busca venganza contra Askeladd mientras participa en las guerras del norte de Europa."},
    {"id": "tt0437086", "title": "Monster", "genre": "Crimen • Drama • Suspenso", "year": "2004-2005", "rating": "8.7", "eps": 26, "synopsis": "Un neurocirujano japonés en Alemania persigue a un expaciente que salvó en su infancia y que ahora es un asesino serial."},
    {"id": "tt5897304", "title": "Mob Psycho 100", "genre": "Acción • Comedia • Sobrenatural", "year": "2016-2022", "rating": "8.6", "eps": 25, "synopsis": "Shigeo Kageyama es un estudiante con inmensos poderes psíquicos que intenta llevar una vida común y corriente."},
    {"id": "tt13706018", "title": "Spy x Family", "genre": "Comedia • Acción • Espías", "year": "2022-", "rating": "8.3", "eps": 25, "synopsis": "Un espía, una asesina y una niña telépata forman una familia falsa para cumplir sus respectivas misiones secretas."},
    {"id": "tt12590266", "title": "Cyberpunk: Edgerunners", "genre": "Acción • Ciencia Ficción", "year": "2022", "rating": "8.3", "eps": 10, "synopsis": "Un chico de la calle intenta sobrevivir en Night City, una ciudad obsesionada con la tecnología y la modificación corporal."},
    {"id": "tt4508902", "title": "One Punch Man", "genre": "Acción • Comedia • Superhéroes", "year": "2015-", "rating": "8.7", "eps": 24, "synopsis": "Saitama puede derrotar a cualquier enemigo de un solo golpe, lo que le provoca un aburrimiento existencial."},
    {"id": "tt3398540", "title": "Haikyuu!!", "genre": "Deportes • Shonen • Comedia", "year": "2014-2020", "rating": "8.7", "eps": 25, "synopsis": "Shoyo Hinata se une al equipo de voleibol de Karasuno para competir contra los mejores jugadores de Japón."},
    {"id": "tt15222080", "title": "Blue Lock", "genre": "Deportes • Shonen • Suspenso", "year": "2022-", "rating": "8.2", "eps": 24, "synopsis": "300 jóvenes delanteros compiten en un campamento de alta exigencia para convertirse en el nuevo goleador de Japón."},
    {"id": "tt21209804", "title": "Mashle: Magic and Muscles", "genre": "Comedia • Acción • Magia", "year": "2023-", "rating": "7.5", "eps": 24, "synopsis": "En un mundo donde la magia lo es todo, Mash entrena sus músculos sin parar para defenderse a fuerza bruta."},
    {"id": "tt21975436", "title": "Kaiju No. 8", "genre": "Acción • Ciencia Ficción • Monstruos", "year": "2024-", "rating": "8.1", "eps": 12, "synopsis": "Kafka Hibino obtiene la habilidad de transformarse en un Kaiju mientras postula a las Fuerzas de Defensa."},
    {"id": "tt30217403", "title": "Dandadan", "genre": "Acción • Comedia • Sobrenatural", "year": "2024-", "rating": "8.5", "eps": 12, "synopsis": "Momo cree en fantasmas y Okarun en alienígenas; ambos descubren que ambos fenómenos existen en su ciudad."},
    {"id": "tt7441658", "title": "Black Clover", "genre": "Shonen • Magia • Acción", "year": "2017-2021", "rating": "8.3", "eps": 26, "synopsis": "Asta nace sin poderes mágicos en un mundo de hechiceros, pero recibe un extraño grimorio de cinco hojas."},
    {"id": "tt2250192", "title": "Sword Art Online", "genre": "Isekai • Acción • Ciencia Ficción", "year": "2012-", "rating": "7.5", "eps": 25, "synopsis": "Kirito queda atrapado dentro de un videojuego de realidad virtual donde morir en el juego significa morir en la vida real."}
]

anime_list = []
for a in CURATED_ANIME:
    aid = a["id"]
    eps_count = a.get("eps", 24)
    episodes = []
    for e in range(1, eps_count + 1):
        episodes.append({
            "epNum": e,
            "title": f"Capítulo {e}",
            "duration": "24m",
            "streamUrl": vod_fallback_urls[e % len(vod_fallback_urls)],
            "synopsis": f"Capítulo {e} oficial con subtítulos en español y doblaje latino HD."
        })
    seasons = [{
        "season": 1,
        "title": "Temporada 1",
        "episodes": episodes
    }]
    anime_list.append({
        "id": aid,
        "title": a["title"],
        "genre": a["genre"],
        "year": a["year"],
        "rating": a["rating"],
        "quality": "1080p HD",
        "synopsis": a["synopsis"],
        "poster": f"https://images.metahub.space/poster/small/{aid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{aid}/img",
        "episodesCount": eps_count,
        "streamUrl": episodes[0]["streamUrl"],
        "seasonList": seasons
    })

print(f"Total Anime prepared: {len(anime_list)}")

# 4. INFANTIL / KIDS (55+)
print("Gathering Kids titles...")
CURATED_KIDS = [
    {"id": "tt22022452", "title": "IntensaMente 2 (Inside Out 2)", "genre": "Animación • Familiar • Comedia", "year": "2024", "duration": "1h 36m", "rating": "7.7", "synopsis": "Riley entra a la adolescencia y su cuartel general sufre una repentina demolición para hacer espacio a nuevas emociones."},
    {"id": "tt2096673", "title": "Intensa-Mente (Inside Out)", "genre": "Animación • Familiar", "year": "2015", "duration": "1h 35m", "rating": "8.1", "synopsis": "Las emociones de una niña pequeña en su cuartel cerebral intentan guiarla a través de una mudanza difícil."},
    {"id": "tt6718170", "title": "Super Mario Bros: La Película", "genre": "Animación • Aventura", "year": "2023", "duration": "1h 32m", "rating": "7.0", "synopsis": "Mario y Luigi son transportados a un mundo subterráneo mágico donde deben rescatar el Reino Champiñón."},
    {"id": "tt0110357", "title": "El Rey León (The Lion King)", "genre": "Animación • Drama • Musical", "year": "1994", "duration": "1h 28m", "rating": "8.5", "synopsis": "El cachorro de león Simba huye de su reino tras la muerte de su padre y aprende el verdadero significado del valor."},
    {"id": "tt0114709", "title": "Toy Story", "genre": "Animación • Aventura • Comedia", "year": "1995", "duration": "1h 21m", "rating": "8.3", "synopsis": "Woody el vaquero se siente amenazado cuando llega Buzz Lightyear, una nueva y deslumbrante figura de acción."},
    {"id": "tt0120363", "title": "Toy Story 2", "genre": "Animación • Aventura", "year": "1999", "duration": "1h 32m", "rating": "7.9", "synopsis": "Cuando Woody es robado por un coleccionista de juguetes, Buzz y sus amigos se disponen a rescatarlo."},
    {"id": "tt0435761", "title": "Toy Story 3", "genre": "Animación • Aventura • Drama", "year": "2010", "duration": "1h 43m", "rating": "8.3", "synopsis": "Los juguetes son entregados por error a una guardería en lugar del ático justo antes de que Andy vaya a la universidad."},
    {"id": "tt1979376", "title": "Toy Story 4", "genre": "Animación • Aventura", "year": "2019", "duration": "1h 40m", "rating": "7.7", "synopsis": "Cuando un nuevo juguete llamado Forky se une a Woody y la pandilla, un viaje por carretera revela lo grande que puede ser el mundo."},
    {"id": "tt0126029", "title": "Shrek", "genre": "Animación • Comedia • Fantasía", "year": "2001", "duration": "1h 30m", "rating": "7.9", "synopsis": "Un ogro huraño se embarca en una misión para rescatar a una hermosa princesa y recuperar la paz en su pantano."},
    {"id": "tt0298148", "title": "Shrek 2", "genre": "Animación • Comedia • Fantasía", "year": "2004", "duration": "1h 33m", "rating": "7.3", "synopsis": "Los padres de Fiona invitan a Shrek y a Fiona a su reino de Muy Muy Lejano para celebrar su matrimonio."},
    {"id": "tt3521164", "title": "Moana (Un Mar de Aventuras)", "genre": "Animación • Aventura • Musical", "year": "2016", "duration": "1h 47m", "rating": "7.6", "synopsis": "En la antigua Polinesia, cuando una terrible maldición llega a su isla, Moana navega en busca del semidiós Maui."},
    {"id": "tt2294629", "title": "Frozen: Una Aventura Congelada", "genre": "Animación • Aventura • Musical", "year": "2013", "duration": "1h 42m", "rating": "7.4", "synopsis": "Cuando el reino queda atrapado en un invierno perpetuo, Anna emprende un viaje para encontrar a su hermana Elsa."},
    {"id": "tt4520988", "title": "Frozen 2", "genre": "Animación • Aventura", "year": "2019", "duration": "1h 43m", "rating": "6.8", "synopsis": "Elsa, Anna, Kristoff, Olaf y Sven viajan a un antiguo bosque encantado para descubrir el origen de los poderes de Elsa."},
    {"id": "tt2380307", "title": "Coco", "genre": "Animación • Familiar • Fantasía", "year": "2017", "duration": "1h 45m", "rating": "8.4", "synopsis": "El joven Miguel viaja a la colorida Tierra de los Muertos para descubrir el misterio de la historia musical de su familia."},
    {"id": "tt2948356", "title": "Zootopia", "genre": "Animación • Aventura • Comedia", "year": "2016", "duration": "1h 48m", "rating": "8.0", "synopsis": "En una ciudad de animales antropomórficos, una oficial de policía coneja y un zorro estafador descubren una conspiración."},
    {"id": "tt2953050", "title": "Encanto", "genre": "Animación • Familiar • Musical", "year": "2021", "duration": "1h 42m", "rating": "7.2", "synopsis": "Una familia colombiana extraordinaria vive en una casa mágica en las montañas de Colombia."},
    {"id": "tt1302011", "title": "Kung Fu Panda 2", "genre": "Animación • Acción • Aventura", "year": "2011", "duration": "1h 30m", "rating": "7.3", "synopsis": "Po y los Cinco Furiosos viajan por toda China para enfrentarse a un villano que amenaza con destruir el Kung Fu."},
    {"id": "tt21692408", "title": "Kung Fu Panda 4", "genre": "Animación • Acción • Comedia", "year": "2024", "duration": "1h 34m", "rating": "6.7", "synopsis": "Po debe entrenar a un nuevo Guerrero Dragón y enfrentarse a La Camaleona, una hechicera que puede cambiar de forma."},
    {"id": "tt0266543", "title": "Buscando a Nemo", "genre": "Animación • Aventura • Comedia", "year": "2003", "duration": "1h 40m", "rating": "8.2", "synopsis": "Un tímido pez payaso emprende un peligroso viaje por el océano para encontrar a su hijo capturado en Sídney."},
    {"id": "tt0317219", "title": "Cars", "genre": "Animación • Aventura • Comedia", "year": "2006", "duration": "1h 57m", "rating": "7.2", "synopsis": "El auto de carreras Rayo McQueen se pierde en Radiador Springs y aprende el valor de la amistad y la humildad."},
    {"id": "tt0317705", "title": "Los Increíbles (The Incredibles)", "genre": "Animación • Acción • Aventura", "year": "2004", "duration": "1h 55m", "rating": "8.0", "synopsis": "Una familia de superhéroes encubiertos intenta vivir una vida suburbana tranquila hasta que se ven obligados a salvar el mundo."},
    {"id": "tt0382932", "title": "Ratatouille", "genre": "Animación • Comedia • Familiar", "year": "2007", "duration": "1h 51m", "rating": "8.1", "synopsis": "Una rata con extraordinario sentido del gusto forja una improbable alianza con un joven lavaplatos en París."},
    {"id": "tt1323594", "title": "Mi Villano Favorito (Despicable Me)", "genre": "Animación • Comedia • Familiar", "year": "2010", "duration": "1h 35m", "rating": "7.6", "synopsis": "Cuando un cerebro criminal planea robar la luna, tres niñas huérfanas ven algo en él que nadie más vio: un padre."},
    {"id": "tt2293640", "title": "Minions", "genre": "Animación • Comedia • Aventura", "year": "2015", "duration": "1h 31m", "rating": "6.4", "synopsis": "Kevin, Stuart y Bob buscan a un nuevo y malvado amo para su tribu y terminan compitiendo en la Villano-Con de 1968."},
    {"id": "tt0910970", "title": "WALL·E", "genre": "Animación • Aventura • Ciencia Ficción", "year": "2008", "duration": "1h 38m", "rating": "8.4", "synopsis": "En el año 2800, un pequeño robot recolector de basura se embarca en un viaje espacial que decidirá el destino de la humanidad."},
    {"id": "tt1049413", "title": "Up: Una Aventura de Altura", "genre": "Animación • Aventura • Comedia", "year": "2009", "duration": "1h 36m", "rating": "8.3", "synopsis": "Un anciano viudo ata miles de globos a su casa para cumplir una promesa y viaja a las Cataratas del Paraíso con un explorador."},
    {"id": "tt0198781", "title": "Monsters, Inc.", "genre": "Animación • Aventura • Comedia", "year": "2001", "duration": "1h 32m", "rating": "8.1", "synopsis": "Dos monstruos que asustan a niños descubren que el miedo humano no es la única fuente de energía en Monstruópolis."},
    {"id": "tt12801262", "title": "Luca", "genre": "Animación • Aventura • Comedia", "year": "2021", "duration": "1h 35m", "rating": "7.4", "synopsis": "En la Riviera italiana, un monstruo marino vive un verano inolvidable junto a su nuevo mejor amigo humano."},
    {"id": "tt8097030", "title": "Red (Turning Red)", "genre": "Animación • Comedia • Familiar", "year": "2022", "duration": "1h 40m", "rating": "7.0", "synopsis": "Una niña de 13 años se convierte en un panda rojo gigante cada vez que experimenta emociones intensas."}
]

kids_list = []
for k in CURATED_KIDS:
    kid = k["id"]
    kids_list.append({
        "id": kid,
        "title": k["title"],
        "genre": k["genre"],
        "year": k["year"],
        "duration": k["duration"],
        "rating": k["rating"],
        "quality": "1080p HD",
        "synopsis": k["synopsis"],
        "poster": f"https://images.metahub.space/poster/small/{kid}/img",
        "backdrop": f"https://images.metahub.space/background/medium/{kid}/img",
        "streamUrl": vod_fallback_urls[len(kids_list) % len(vod_fallback_urls)]
    })

print(f"Total Kids prepared: {len(kids_list)}")

# 5. DEPORTES (30+ MATCHES - LIMA GMT-5)
print("Gathering Sports...")
SPORTS_MATCHES = [
    {"id": "sp-1", "title": "Universitario vs Alianza Lima", "tournament": "Liga 1 Te Apuesto - Clásico Peruano", "category": "futbol", "time": "Domingo 15:30 (Hora Lima)", "stadium": "Estadio Monumental U Marathon", "teams": "U vs AL", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "http://190.93.224.42/AMERICA-TV/index.m3u8"},
    {"id": "sp-2", "title": "Sporting Cristal vs Melgar F.C.", "tournament": "Liga 1 Perú - Torneo Clausura", "category": "futbol", "time": "Sábado 13:00 (Hora Lima)", "stadium": "Estadio Alberto Gallardo (Lima)", "teams": "SC vs FBC", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "http://190.93.224.42/LATINA/index.m3u8"},
    {"id": "sp-3", "title": "Selección Peruana vs Chile", "tournament": "Eliminatorias Sudamericanas 2026", "category": "futbol", "time": "Jueves 20:30 (Hora Lima)", "stadium": "Estadio Nacional de Lima", "teams": "PER vs CHI", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "http://190.93.224.42/ATV/index.m3u8"},
    {"id": "sp-4", "title": "Argentina vs Selección Peruana", "tournament": "Eliminatorias Conmebol - Fecha FIFA", "category": "futbol", "time": "Martes 19:00 (Hora Lima)", "stadium": "Estadio Monumental de Núñez", "teams": "ARG vs PER", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "http://190.93.224.42/AMERICA-TV/index.m3u8"},
    {"id": "sp-5", "title": "Cienciano vs Cusco FC", "tournament": "Liga 1 Perú - Clásico Cusqueño", "category": "futbol", "time": "Viernes 17:30 (Hora Lima)", "stadium": "Estadio Inca Garcilaso de la Vega", "teams": "CIE vs CUS", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "http://45.171.108.253:8888/PANAMERICANA/index.m3u8"},
    {"id": "sp-6", "title": "Real Madrid vs FC Barcelona", "tournament": "LaLiga EA Sports - El Clásico", "category": "futbol", "time": "Domingo 14:00 (Hora Lima)", "stadium": "Estadio Santiago Bernabéu", "teams": "RMA vs FCB", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-7", "title": "Manchester City vs Arsenal", "tournament": "Premier League - Duelo por la Cima", "category": "futbol", "time": "Sábado 11:30 (Hora Lima)", "stadium": "Etihad Stadium (Manchester)", "teams": "MCI vs ARS", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-8", "title": "Liverpool vs Manchester United", "tournament": "Premier League - Clásico del Noroeste", "category": "futbol", "time": "Domingo 10:30 (Hora Lima)", "stadium": "Anfield (Liverpool)", "teams": "LIV vs MUN", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-9", "title": "Bayern Múnich vs Borussia Dortmund", "tournament": "Bundesliga - Der Klassiker", "category": "futbol", "time": "Sábado 11:30 (Hora Lima)", "stadium": "Allianz Arena (Múnich)", "teams": "FCB vs BVB", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-10", "title": "River Plate vs Boca Juniors", "tournament": "Liga Profesional - Superclásico Argentino", "category": "futbol", "time": "Domingo 15:00 (Hora Lima)", "stadium": "Estadio Más Monumental", "teams": "CARP vs CABJ", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-11", "title": "Final Copa Libertadores 2026", "tournament": "Conmebol Libertadores - Gran Final", "category": "futbol", "time": "Sábado 15:00 (Hora Lima)", "stadium": "Estadio Monumental de Lima", "teams": "FINAL", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-12", "title": "Real Madrid vs Paris Saint-Germain", "tournament": "UEFA Champions League - Octavos de Final", "category": "futbol", "time": "Miércoles 14:00 (Hora Lima)", "stadium": "Estadio Santiago Bernabéu", "teams": "RMA vs PSG", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-13", "title": "Formula 1: Gran Premio de São Paulo", "tournament": "Fórmula 1 2026 - Carrera Principal", "category": "f1", "time": "Domingo 12:00 (Hora Lima)", "stadium": "Autódromo José Carlos Pace (Interlagos)", "teams": "F1 GP", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-14", "title": "Formula 1: Gran Premio de Las Vegas", "tournament": "Fórmula 1 - Carrera Nocturna", "category": "f1", "time": "Sábado 23:00 (Hora Lima)", "stadium": "Circuito Callejero de Las Vegas Strip", "teams": "F1 Night", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-15", "title": "Boston Celtics vs Los Angeles Lakers", "tournament": "NBA Regular Season - Rivalidad Histórica", "category": "nba", "time": "Viernes 20:30 (Hora Lima)", "stadium": "TD Garden (Boston)", "teams": "BOS vs LAL", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-16", "title": "Golden State Warriors vs Denver Nuggets", "tournament": "NBA Western Conference Clash", "category": "nba", "time": "Miércoles 21:00 (Hora Lima)", "stadium": "Chase Center (San Francisco)", "teams": "GSW vs DEN", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-17", "title": "UFC 310: Pelea de Campeonato", "tournament": "UFC Pay-Per-View - Cartelera Estelar", "category": "combate", "time": "Sábado 21:00 (Hora Lima)", "stadium": "T-Mobile Arena (Las Vegas)", "teams": "UFC PPV", "quality": "4K Ultra HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"},
    {"id": "sp-18", "title": "Carlos Alcaraz vs Jannik Sinner", "tournament": "ATP Finals - Gran Final", "category": "tenis", "time": "Domingo 12:30 (Hora Lima)", "stadium": "Pala Alpitour (Turín)", "teams": "ALC vs SIN", "quality": "1080p HD", "poster": "assets/backdrop.png", "streamUrl": "https://rtvelivestream.akamaized.net/tdp_es.m3u8"}
]
print(f"Total Sports matches: {len(SPORTS_MATCHES)}")

# 6. MÚSICA / CONCIERTOS (30+)
print("Gathering Music...")
MUSIC_ITEMS = [
    {"id": "mus-1", "title": "Coldplay: Live at River Plate (Buenos Aires)", "artist": "Coldplay", "year": "2022", "duration": "2h 15m", "rating": "9.4", "quality": "4K Ultra HD", "synopsis": "Concierto histórico en el Estadio River Plate de Buenos Aires durante la gira Music of the Spheres con invitados especiales.", "poster": "https://images.metahub.space/poster/small/tt26934645/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "mus-2", "title": "Metallica & San Francisco Symphony: S&M2", "artist": "Metallica", "year": "2019", "duration": "2h 30m", "rating": "8.8", "quality": "4K Ultra HD", "synopsis": "Concierto monumental que celebra los 20 años del álbum S&M junto a la Orquesta Sinfónica de San Francisco.", "poster": "https://images.metahub.space/poster/small/tt10765852/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "mus-3", "title": "Queen: Live at Wembley Stadium", "artist": "Queen", "year": "1986", "duration": "1h 50m", "rating": "9.6", "quality": "1080p Remaster", "synopsis": "La legendaria actuación de Freddie Mercury y Queen en el Estadio Wembley de Londres en el Magic Tour de 1986.", "poster": "https://images.metahub.space/poster/small/tt0117424/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "mus-4", "title": "Nirvana: MTV Unplugged in New York", "artist": "Nirvana", "year": "1993", "duration": "1h 06m", "rating": "9.5", "quality": "1080p HD", "synopsis": "La íntima e inmortal sesión acústica de Kurt Cobain y Nirvana en los estudios de Sony Music en Nueva York.", "poster": "https://m.media-amazon.com/images/M/MV5BOWVhNDMzOTYtNjIyMy00ZjA2LWI1MzYtMmNiNTVlMjQxNzg2XkEyXkFqcGc@._V1_SX250.jpg", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "mus-5", "title": "Hans Zimmer: Live in Prague", "artist": "Hans Zimmer", "year": "2017", "duration": "2h 18m", "rating": "9.1", "quality": "4K Ultra HD", "synopsis": "El legendario compositor interpreta en vivo las bandas sonoras de Gladiator, Inception, Interstellar, The Dark Knight y El Rey León.", "poster": "https://images.metahub.space/poster/small/tt5732482/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "mus-6", "title": "AC/DC: Live at River Plate (Buenos Aires)", "artist": "AC/DC", "year": "2009", "duration": "1h 50m", "rating": "9.2", "quality": "1080p HD", "synopsis": "La explosiva actuación de la banda de rock australiana ante 200,000 fanáticos en el Estadio Monumental de Buenos Aires.", "poster": "https://images.metahub.space/poster/small/tt1924185/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "mus-7", "title": "Taylor Swift: The Eras Tour Concert Film", "artist": "Taylor Swift", "year": "2023", "duration": "2h 48m", "rating": "8.2", "quality": "4K Ultra HD", "synopsis": "La película del concierto que capturó el fenómeno global de la gira que recorrió todas las épocas de su carrera musical.", "poster": "https://images.metahub.space/poster/small/tt28814949/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"},
    {"id": "mus-8", "title": "Billie Eilish: Live at The O2 (Extended Cut)", "artist": "Billie Eilish", "year": "2023", "duration": "1h 35m", "rating": "8.5", "quality": "4K Ultra HD", "synopsis": "La emocionante presentación en vivo de Billie Eilish ante un público repleto en The O2 Arena en Londres.", "poster": "https://images.metahub.space/poster/small/tt26348071/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"},
    {"id": "mus-9", "title": "Elton John Live: Farewell from Dodger Stadium", "artist": "Elton John", "year": "2022", "duration": "2h 45m", "rating": "8.6", "quality": "4K Ultra HD", "synopsis": "El legendario concierto de despedida de Elton John en el Dodger Stadium de Los Ángeles tras cincuenta años de giras.", "poster": "https://images.metahub.space/poster/small/tt22029066/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "mus-10", "title": "Homecoming: A Film by Beyoncé (Coachella)", "artist": "Beyoncé", "year": "2019", "duration": "2h 17m", "rating": "8.7", "quality": "4K Ultra HD", "synopsis": "Una mirada íntima e histórica a la celebrada actuación de Beyoncé en el Festival de Música y Artes de Coachella Valley en 2018.", "poster": "https://images.metahub.space/poster/small/tt10147546/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "mus-11", "title": "Soda Stereo: Me Verás Volver (Gira Histórica)", "artist": "Soda Stereo", "year": "2007", "duration": "2h 20m", "rating": "9.5", "quality": "1080p HD", "synopsis": "Gustavo Cerati, Zeta Bosio y Charly Alberti reunidos en una de las giras más multitudinarias del rock en español.", "poster": "https://images.metahub.space/poster/small/tt1243950/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "mus-12", "title": "Gustavo Cerati: Ahí Vamos Tour en Vivo", "artist": "Gustavo Cerati", "year": "2007", "duration": "1h 55m", "rating": "9.3", "quality": "1080p HD", "synopsis": "Cerati en vivo con su banda en el Estadio Obras de Buenos Aires presentando su aclamado álbum solista Ahí Vamos.", "poster": "https://images.metahub.space/poster/small/tt10765852/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "mus-13", "title": "Pink Floyd: P.U.L.S.E Live at Earls Court", "artist": "Pink Floyd", "year": "1994", "duration": "2h 25m", "rating": "9.4", "quality": "1080p Remaster", "synopsis": "La interpretación en vivo completa de The Dark Side of the Moon con una producción visual revolucionaria en Londres.", "poster": "https://images.metahub.space/poster/small/tt0110839/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "mus-14", "title": "Michael Jackson: Live in Bucharest (Dangerous Tour)", "artist": "Michael Jackson", "year": "1992", "duration": "2h 02m", "rating": "9.0", "quality": "1080p HD", "synopsis": "El Rey del Pop en el Estadio Nacional de Bucarest ante más de 70,000 personas en la cúspide de su gira Dangerous.", "poster": "https://images.metahub.space/poster/small/tt0463345/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "mus-15", "title": "Linkin Park: Live in Texas (Road to Revolution)", "artist": "Linkin Park", "year": "2003", "duration": "1h 12m", "rating": "9.2", "quality": "1080p HD", "synopsis": "Chester Bennington y Mike Shinoda brindan una actuación electrizante en Irving, Texas, interpretando éxitos de Hybrid Theory y Meteora.", "poster": "https://images.metahub.space/poster/small/tt0402347/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"}
]
print(f"Total Music items: {len(MUSIC_ITEMS)}")

# 7. DOCUMENTALES (30+)
print("Gathering Documentaries...")
DOCS_ITEMS = [
    {"id": "doc-1", "title": "Planeta Tierra (Planet Earth)", "category": "Naturaleza", "year": "2006", "duration": "11 Episodios", "rating": "9.4", "quality": "4K Ultra HD", "synopsis": "Una de las series documentales más aclamadas de la BBC, narrada por Sir David Attenborough, mostrando la vida salvaje del planeta.", "poster": "https://images.metahub.space/poster/small/tt0795176/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "doc-2", "title": "Planeta Tierra II (Planet Earth II)", "category": "Naturaleza", "year": "2016", "duration": "6 Episodios", "rating": "9.5", "quality": "4K Ultra HD", "synopsis": "David Attenborough regresa para explorar las islas, montañas, selvas, desiertos y praderas de la Tierra con tecnología de ultra alta definición.", "poster": "https://images.metahub.space/poster/small/tt5491994/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "doc-3", "title": "Nuestro Planeta (Our Planet)", "category": "Naturaleza • Medio Ambiente", "year": "2019", "duration": "8 Episodios", "rating": "9.3", "quality": "4K Ultra HD", "synopsis": "Un viaje impresionante por los hábitats más preciosos de la Tierra y las especies amenazadas por el cambio climático.", "poster": "https://images.metahub.space/poster/small/tt9253866/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "doc-4", "title": "Cosmos: Mundos Posibles", "category": "Ciencia • Astronomía", "year": "2020", "duration": "13 Episodios", "rating": "9.1", "quality": "4K Ultra HD", "synopsis": "Neil deGrasse Tyson nos transporta a través de la nave de la imaginación para explorar reinos perdidos y mundos por descubrir en el cosmos.", "poster": "https://images.metahub.space/poster/small/tt11170862/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "doc-5", "title": "Fórmula 1: Drive to Survive", "category": "Deportes • Motor", "year": "2019-2024", "duration": "6 Temporadas", "rating": "8.5", "quality": "4K Ultra HD", "synopsis": "Pilotos, directores de equipo y propietarios viven la vida a máxima velocidad tanto dentro como fuera de la pista durante el campeonato mundial.", "poster": "https://images.metahub.space/poster/small/tt8289930/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "doc-6", "title": "El Último Baile (The Last Dance)", "category": "Deportes • Baloncesto", "year": "2020", "duration": "10 Episodios", "rating": "9.1", "quality": "4K Ultra HD", "synopsis": "La crónica definitiva del ascenso de Michael Jordan y la legendaria dinastía de los Chicago Bulls de la década de 1990.", "poster": "https://images.metahub.space/poster/small/tt8420184/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "doc-7", "title": "Andes Mágicos (Magical Andes)", "category": "Cultura • Geografía", "year": "2019-2021", "duration": "2 Temporadas", "rating": "8.2", "quality": "4K Ultra HD", "synopsis": "Un viaje visual inolvidable por la imponente cordillera de los Andes, desde las cumbres de Colombia, Ecuador y Perú hasta la Patagonia.", "poster": "https://images.metahub.space/poster/small/tt11229002/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"},
    {"id": "doc-8", "title": "Imperio Romano: El Reinado de Sangre", "category": "Historia • Drama", "year": "2016-2019", "duration": "3 Temporadas", "rating": "7.0", "quality": "1080p HD", "synopsis": "Una combinación magistral de documental y recreación histórica sobre los reinados de Cómodo, Julio César y Calígula en la Antigua Roma.", "poster": "https://images.metahub.space/poster/small/tt6233538/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"},
    {"id": "doc-9", "title": "La Segunda Guerra Mundial en Color", "category": "Historia • Bélico", "year": "2009", "duration": "13 Episodios", "rating": "8.8", "quality": "1080p Remaster", "synopsis": "Imágenes originales de archivo restauradas y coloreadas que relatan los eventos más trascendentales de la Segunda Guerra Mundial.", "poster": "https://images.metahub.space/poster/small/tt2069688/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"},
    {"id": "doc-10", "title": "Free Solo", "category": "Aventura • Escalada", "year": "2018", "duration": "1h 40m", "rating": "8.1", "quality": "4K Ultra HD", "synopsis": "El escalador profesional Alex Honnold intenta la hazaña histórica de escalar en solitario libre la pared de 900 metros de El Capitán en Yosemite.", "poster": "https://images.metahub.space/poster/small/tt7775622/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"},
    {"id": "doc-11", "title": "El Dilema de las Redes Sociales (The Social Dilemma)", "category": "Tecnología • Sociedad", "year": "2020", "duration": "1h 34m", "rating": "7.6", "quality": "4K Ultra HD", "synopsis": "Expertos en tecnología y creadores de Silicon Valley alertan sobre el impacto peligroso de las redes sociales en la mente y la democracia.", "poster": "https://images.metahub.space/poster/small/tt11464826/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"},
    {"id": "doc-12", "title": "14 Ochomiles: Los Límites de lo Imposible", "category": "Montañismo • Aventura", "year": "2021", "duration": "1h 41m", "rating": "7.7", "quality": "4K Ultra HD", "synopsis": "El intrépido alpinista nepalí Nimsdai Purja emprende una misión aparentemente imposible: coronar los 14 picos más altos del mundo en solo 7 meses.", "poster": "https://images.metahub.space/poster/small/tt14079374/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"},
    {"id": "doc-13", "title": "David Attenborough: Una Vida en Nuestro Planeta", "category": "Naturaleza • Biografía", "year": "2020", "duration": "1h 23m", "rating": "8.9", "quality": "4K Ultra HD", "synopsis": "El célebre naturalista reflexiona sobre su trayectoria y los cambios devastadores en la biodiversidad global, ofreciendo una visión para el futuro.", "poster": "https://images.metahub.space/poster/small/tt11989890/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"},
    {"id": "doc-14", "title": "Mi Maestro el Pulpo (My Octopus Teacher)", "category": "Naturaleza • Documental", "year": "2020", "duration": "1h 25m", "rating": "8.1", "quality": "4K Ultra HD", "synopsis": "Un cineasta forja una inusual amistad con un pulpo que habita en un bosque de algas marinas en Sudáfrica, aprendiendo lecciones de vida.", "poster": "https://images.metahub.space/poster/small/tt12888462/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"},
    {"id": "doc-15", "title": "Senna", "category": "Deportes • Biografía", "year": "2010", "duration": "1h 46m", "rating": "8.5", "quality": "1080p HD", "synopsis": "El aclamado documental sobre la vida y trágico destino del tricampeón mundial brasileño de Fórmula 1, Ayrton Senna.", "poster": "https://images.metahub.space/poster/small/tt1424432/img", "streamUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4"}
]
print(f"Total Documentaries: {len(DOCS_ITEMS)}")

# 8. WRITE SRC/DATA.JS
print("Writing compiled master data to src/data.js...")
with open('src/data.js', 'w', encoding='utf-8') as out:
    out.write('// SwordTV Comprehensive Master Database V3\n')
    out.write('// Auto-generated with extensive verified catalogs and real metadata\n\n')
    
    out.write('export const CATEGORIES = [\n')
    categories = [
        {"id": "live", "name": "En Vivo", "icon": "📺"},
        {"id": "movies", "name": "Películas", "icon": "🎬"},
        {"id": "series", "name": "Series", "icon": "🍿"},
        {"id": "anime", "name": "Anime", "icon": "⛩️"},
        {"id": "kids", "name": "Infantil", "icon": "🐥"},
        {"id": "sports", "name": "Deportes", "icon": "⚽"},
        {"id": "music", "name": "Música", "icon": "🎵"},
        {"id": "docs", "name": "Documentales", "icon": "📚"},
        {"id": "favorites", "name": "Favoritos", "icon": "⭐"},
        {"id": "settings", "name": "Configuración", "icon": "⚙️"}
    ]
    for c in categories:
        out.write(f'  {json.dumps(c, ensure_ascii=False)},\n')
    out.write('];\n\n')

    out.write('export const LIVE_SUBCATEGORIES = [\n')
    subcats = [
        {"id": "all", "name": "Todos los Canales", "icon": "🌐"},
        {"id": "peru", "name": "Perú Nacional", "icon": "🇵🇪"},
        {"id": "espana", "name": "España TDT", "icon": "🇪🇸"},
        {"id": "cine", "name": "Cine & Series Premium", "icon": "🎬"},
        {"id": "deportes", "name": "Deportes en Vivo", "icon": "⚽"},
        {"id": "noticias", "name": "Noticias 24h", "icon": "📰"},
        {"id": "anime", "name": "Anime & Animación", "icon": "⛩️"},
        {"id": "infantil", "name": "Infantil & Kids", "icon": "🐥"},
        {"id": "cultura", "name": "Documentales & Cultura", "icon": "🌍"},
        {"id": "musica", "name": "Música & Conciertos", "icon": "🎵"},
        {"id": "entretenimiento", "name": "Entretenimiento Variado", "icon": "✨"}
    ]
    for sc in subcats:
        out.write(f'  {json.dumps(sc, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Channels
    from build_full_catalogs import all_channels
    out.write('export const CHANNELS = [\n')
    for ch in all_channels:
        out.write(f'  {json.dumps(ch, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Movies
    out.write('export const MOVIES = [\n')
    for m in movies_list:
        out.write(f'  {json.dumps(m, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Series
    out.write('export const SERIES = [\n')
    for s in series_list:
        out.write(f'  {json.dumps(s, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Anime
    out.write('export const ANIME = [\n')
    for a in anime_list:
        out.write(f'  {json.dumps(a, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Kids
    out.write('export const KIDS = [\n')
    for k in kids_list:
        out.write(f'  {json.dumps(k, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Music
    out.write('export const MUSIC_ITEMS = [\n')
    for mu in MUSIC_ITEMS:
        out.write(f'  {json.dumps(mu, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Docs
    out.write('export const DOCS_ITEMS = [\n')
    for d in DOCS_ITEMS:
        out.write(f'  {json.dumps(d, ensure_ascii=False)},\n')
    out.write('];\n\n')

    # Sports
    out.write('export const SPORTS_MATCHES = [\n')
    for sp in SPORTS_MATCHES:
        out.write(f'  {json.dumps(sp, ensure_ascii=False)},\n')
    out.write('];\n')

print("SUCCESS: Master catalog data compiled successfully into src/data.js!")
