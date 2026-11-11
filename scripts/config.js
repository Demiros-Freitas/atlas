// Atlas · constantes e tabelas do módulo.
export const MODULE_ID = "brumas-atlas";
export const SOCKET = `module.${MODULE_ID}`;

/** Níveis de mapa. */
export const LEVELS = {
  mundo: { label: "Mundo" },
  regiao: { label: "Região" },
  cidade: { label: "Cidade" },
  local: { label: "Local" },
  ceu: { label: "Céu" }
};

/** Tipos de local. size = diâmetro do marcador em px de tela; minor = some quando o mapa está bem afastado. */
export const POI_KINDS = {
  capital: { label: "Capital", icon: "capital", size: 40, minor: false },
  cidade: { label: "Cidade", icon: "city", size: 34, minor: false },
  vila: { label: "Vila", icon: "village", size: 26, minor: true },
  local: { label: "Local", icon: "house", size: 26, minor: true },
  porto: { label: "Porto", icon: "anchor", size: 26, minor: true },
  acamp: { label: "Acampamento", icon: "tent", size: 26, minor: true },
  masmorra: { label: "Masmorra", icon: "cave", size: 26, minor: true, danger: true },
  ruina: { label: "Ruína", icon: "ruin", size: 26, minor: true },
  marco: { label: "Marco", icon: "flag", size: 22, minor: true },
  distrito: { label: "Distrito", icon: "district", size: 26, minor: false },
  edificio: { label: "Edifício", icon: "shop", size: 24, minor: true },
  natural: { label: "Lugar natural", icon: "forest", size: 26, minor: true },
  vigia: { label: "Torre de vigia", icon: "watchtower", size: 24, minor: true },
  fazenda: { label: "Fazenda / plantação", icon: "farm", size: 24, minor: true },
  apiario: { label: "Apiário", icon: "beehive", size: 26, minor: true },
  farol: { label: "Farol", icon: "lighthouse", size: 28, minor: false },
  estaleiro: { label: "Estaleiro", icon: "shipyard", size: 26, minor: true },
  algodoal: { label: "Algodoal / campo", icon: "cotton", size: 24, minor: true },
  capela: { label: "Capela / santuário", icon: "chapel", size: 24, minor: true },
  cemiterio: { label: "Cemitério", icon: "graveyard", size: 24, minor: true },
  cabana: { label: "Cabana", icon: "hut", size: 24, minor: true },
  aldeia: { label: "Aldeia tribal", icon: "huts", size: 26, minor: true },
  sumidouro: { label: "Sumidouro / fenda", icon: "sinkhole", size: 26, minor: true, danger: true },
  onirico: { label: "Lugar onírico", icon: "portal", size: 26, minor: true },
  circulo: { label: "Portal", icon: "portal", size: 28, minor: false },
  hospedaria: { label: "Hospedaria / estalagem", icon: "inn", size: 24, minor: true },
  taverna: { label: "Taverna", icon: "tavern", size: 24, minor: true },
  restaurante: { label: "Restaurante", icon: "restaurant", size: 24, minor: true },
  loja: { label: "Loja", icon: "shop", size: 24, minor: true },
  mercado: { label: "Mercado / feira", icon: "market", size: 26, minor: true },
  ferreiro: { label: "Ferreiro", icon: "smithy", size: 24, minor: true },
  alquimista: { label: "Alquimista / boticário", icon: "alchemist", size: 24, minor: true },
  banco: { label: "Banco / cambista", icon: "bank", size: 24, minor: true },
  guilda: { label: "Guilda", icon: "guild", size: 24, minor: true },
  biblioteca: { label: "Biblioteca", icon: "library", size: 24, minor: true },
  academia: { label: "Escola / academia", icon: "academy", size: 24, minor: true },
  templo: { label: "Templo", icon: "temple", size: 26, minor: true },
  clinica: { label: "Curandeiro / clínica", icon: "clinic", size: 24, minor: true },
  teatro: { label: "Teatro / arena", icon: "theater", size: 24, minor: true },
  banhos: { label: "Casa de banhos", icon: "bath", size: 24, minor: true },
  estabulo: { label: "Estábulo", icon: "stable", size: 24, minor: true },
  quartel: { label: "Quartel / guarnição", icon: "barracks", size: 24, minor: true },
  prisao: { label: "Prisão", icon: "prison", size: 24, minor: true },
  castelo: { label: "Castelo / fortaleza", icon: "castle", size: 30, minor: false },
  mina: { label: "Mina", icon: "mine", size: 24, minor: true },
  moinho: { label: "Moinho", icon: "windmill", size: 24, minor: true },
  serraria: { label: "Serraria", icon: "sawmill", size: 24, minor: true },
  saida: { label: "Saída / entrada de mapa", icon: "gate", size: 26, minor: false }
};
/** Categorias de local (o tipo escolhido é o subtipo; o ícone vem dele). */
export const POI_CATS = {
  assentamento: { label: "Assentamento", kinds: ["capital", "cidade", "vila", "aldeia", "distrito", "acamp"] },
  edificio: { label: "Edifício", kinds: ["edificio", "hospedaria", "taverna", "restaurante", "loja", "mercado", "ferreiro", "alquimista", "banco", "guilda", "biblioteca", "academia", "templo", "capela", "clinica", "teatro", "banhos", "estabulo", "quartel", "prisao", "castelo", "vigia", "cabana"] },
  naval: { label: "Porto e mar", kinds: ["porto", "estaleiro", "farol"] },
  producao: { label: "Produção", kinds: ["fazenda", "apiario", "algodoal", "mina", "moinho", "serraria"] },
  natureza: { label: "Natureza", kinds: ["natural", "sumidouro"] },
  perigo: { label: "Perigo e ruínas", kinds: ["masmorra", "ruina", "cemiterio"] },
  marco: { label: "Marco, saída e mistério", kinds: ["saida", "marco", "local", "onirico"] }
};
export const catOf = (kind) => Object.entries(POI_CATS).find(([, c]) => c.kinds.includes(kind))?.[0] ?? "marco";

/** Estado de um local para os jogadores. */
export const POI_STATES = {
  oculto: { label: "Desconhecido", order: 0 },
  rumor: { label: "Rumor", order: 1 },
  avistado: { label: "Avistado", order: 2 },
  visitado: { label: "Visitado", order: 3 }
};

/**
 * Tipos de rota.
 *  mult    = multiplicador de velocidade próprio do caminho
 *  terrain = se o terreno da zona também pesa (estrada ignora)
 *  modes   = transportes que passam por padrão
 */
export const ROUTE_TYPES = {
  estrada: { label: "Estrada", mult: 1, terrain: false, modes: ["pe", "montaria", "carruagem"], color: "#6e4e2b", width: 3, dash: "" },
  trilha: { label: "Trilha", mult: 1, terrain: true, modes: ["pe", "montaria"], color: "#6e4e2b", width: 2.4, dash: "7 6" },
  passagem: { label: "Passagem", mult: 0.75, terrain: true, modes: ["pe"], color: "#7a5230", width: 2.4, dash: "2 6" },
  rio: { label: "Rio", mult: 1, terrain: false, modes: ["barco"], color: "#2f6f95", width: 3, dash: "10 6" },
  mar: { label: "Rota marítima", mult: 1, terrain: false, modes: ["barco"], color: "#4f9cc8", width: 2.4, dash: "12 7" },
  aerea: { label: "Rota aérea", mult: 1, terrain: false, modes: ["voo", "espaco"], color: "#c9e6ff", width: 1.8, dash: "2 7" },
  portal: { label: "Ligação de portais", mult: 1, terrain: false, modes: ["pe", "montaria", "carruagem", "barco", "voo", "espaco"], color: "#b58ce8", width: 2, dash: "2 6", portal: true },
  rua: { label: "Rua", mult: 1, terrain: false, modes: ["pe", "montaria", "carruagem"], color: "#a07a4a", width: 2.2, dash: "" },
  beco: { label: "Beco", mult: 0.9, terrain: false, modes: ["pe", "montaria"], color: "#7d5d3a", width: 1.3, dash: "" }
};

export const ROUTE_CONDITIONS = {
  aberta: { label: "Aberta" },
  bloqueada: { label: "Bloqueada" },
  sazonal: { label: "Sazonal" },
  pedagio: { label: "Pedágio" }
};

/** Ritmo de viagem: multiplica a velocidade do transporte (30 ft = 3 mi/h no ritmo normal). */
export const PACES = {
  lento: { label: "Lento", mph: 2, f: 2 / 3, note: "Furtivo: o grupo pode se mover em silêncio." },
  normal: { label: "Normal", mph: 3, f: 1, note: "Sem modificadores." },
  rapido: { label: "Rápido", mph: 4, f: 4 / 3, note: "−5 na Percepção passiva durante a viagem." }
};

/** Transportes. mult multiplica o ritmo; fixed (mph) ignora o ritmo. */
export const MODES = {
  pe: { label: "A pé", mult: 1 },
  montaria: { label: "Montaria", mult: 1.25 },
  carruagem: { label: "Veículo terrestre", short: "Terrestre", mult: 1 },
  barco: { label: "Veículo aquático", short: "Aquático", fixed: 3 },
  voo: { label: "Veículo aéreo", short: "Aéreo", mult: 1 },
  espaco: { label: "Veículo espacial", short: "Espacial", mult: 1 }
};
/** Voa (aéreo ou espacial): linha reta, sem depender de estradas. */
export const isAir = (m) => m === "voo" || m === "espaco";
/** Quem passa num terreno quando o mestre não escolheu (a água segue as regras de rasa/funda). */
export function zoneDefaultModes(z) {
  if (!z) return Object.keys(MODES);
  if (z.deep) return ["barco", "voo", "espaco"];
  if (z.water && !z.shallow) return ["pe", "montaria", "barco", "voo", "espaco"];
  if (z.water) return ["pe", "montaria", "carruagem", "barco", "voo", "espaco"];
  return ["pe", "montaria", "carruagem", "voo", "espaco"];
}

/** Zonas (Regiões do Foundry). Palavras do nome escolhem o padrão quando a Região não foi configurada. */
export const ZONE_PRESETS = {
  planicie: { label: "Planície", words: ["planic", "campo", "prado", "plain"], mult: 1, biome: "planicie", chance: [1, 8], color: "#cbc372" },
  bosque: { label: "Bosque", words: ["bosque", "arvore", "mata", "wood"], mult: 1, biome: "floresta", chance: [1, 6], color: "#9add7e" },
  floresta: { label: "Floresta densa", words: ["floresta", "selva", "jungle", "forest", "vegetacao densa"], mult: 0.5, biome: "floresta", chance: [1, 6], color: "#2f6b3a" },
  montanha: { label: "Montanha", words: ["cordilheira", "montanha", "serra", "monte", "pico", "mountain"], mult: 0.5, biome: "montanha", chance: [1, 6], color: "#8a6a3a" },
  colina: { label: "Colinas", words: ["colina", "morro", "hill"], mult: 0.75, biome: "montanha", chance: [1, 8], color: "#bfac76" },
  pantano: { label: "Pântano", words: ["pantano", "brejo", "charco", "swamp", "marsh", "fens"], mult: 0.5, biome: "pantano", chance: [1, 6], color: "#6728cc" },
  deserto: { label: "Deserto", words: ["deserto", "duna", "desert"], mult: 0.75, biome: "deserto", chance: [1, 8], color: "#e0c178" },
  neve: { label: "Neve", words: ["neve", "gelo", "tundra", "snow", "ice"], mult: 0.5, biome: "neve", chance: [1, 8], color: "#dfe8ee" },
  // fundação: construção (cais, plataforma, aterro, cidade sobre a água). Fica por cima das outras zonas: onde há fundação, anda-se como em terra firme.
  fundacao: { label: "Fundação (construção)", words: ["fundac", "foundation", "plataforma", "aterro", "palafita"], mult: 1, biome: "planicie", chance: [1, 10], color: "#a89a82", base: true },
  rasa: { label: "Água rasa", words: ["agua rasa", "rasa", "raso", "vau", "alagad", "mangue", "brejo raso", "shallow", "ford"], mult: 0.5, biome: "costa", chance: [1, 10], color: "#5aa6c8", water: true, shallow: true },
  costa: { label: "Costa (águas costeiras)", words: ["costa", "costeir", "litoral", "coast"], mult: 0.6, biome: "costa", chance: [1, 10], color: "#4f9cc0", water: true, shallow: true },
  oceano: { label: "Oceano", words: ["oceano", "ocean"], mult: 1, biome: "costa", chance: [1, 12], color: "#163f73", water: true, deep: true },
  altomar: { label: "Alto-mar", words: ["alto-mar", "alto mar", "mar aberto", "open sea", "high sea"], mult: 1, biome: "costa", chance: [1, 10], color: "#10325e", water: true, deep: true, rough: true },
  funda: { label: "Água funda", words: ["agua funda", "funda", "fundo", "profund", "deep"], mult: 1, biome: "costa", chance: [1, 12], color: "#1f4f86", water: true, deep: true },
  agua: { label: "Água", words: ["rio", "lago", "baia", "mar", "agua", "oceano", "corpo d"], mult: 1, biome: "costa", chance: [1, 10], color: "#287dcc", water: true },
  areia: { label: "Faixa de areia", words: ["praia", "faixa de areia", "areal", "restinga", "beach", "sand"], mult: 0.75, biome: "costa", chance: [1, 10], color: "#e8d9a8" }
};

export const HOURS_PER_DAY = 8;
export const REVEAL_CELLS = 2;      // raio revelado ao redor do caminho, em células
export const SIGHT_CELLS = 3;       // locais a esta distância do caminho passam a "avistado"

export const USER_COLORS = ["#e08a2c", "#2a6fb0", "#3a9a5a", "#b04a8a", "#8a6ad0", "#c0a030", "#3aa0a0"];

/** Elementos móveis (marcadores flutuantes): grupos, pessoas e veículos. */
export const MOVER_KINDS = {
  grupo: { label: "Grupo", icon: "viajantes", color: "#2a6fb0" },
  pessoa: { label: "Pessoa", icon: "elmo", color: "#7a4ab0" },
  veiculo: { label: "Veículo", icon: "carroca", color: "#b0702a" },
  navio: { label: "Navio", icon: "navio", color: "#2a8aa0" },
  balao: { label: "Balão", icon: "balao", color: "#b04a5a", air: true, mph: 5 },
  aeronave: { label: "Aeronave", icon: "aeronave", color: "#5a6ab0", air: true, mph: 8 }
};

/** Tipo de veículo da ficha (dnd5e: system.details.type): ícone e modo de viagem. */
export const VEHICLE_TYPES = {
  land: { label: "Terrestre", icon: "carroca", mode: "carruagem", kind: "veiculo", speed: "land" },
  water: { label: "Aquático", icon: "navio", mode: "barco", kind: "navio", speed: "water" },
  air: { label: "Aéreo", icon: "balao", mode: "voo", kind: "balao", speed: "air" },
  space: { label: "Espacial", icon: "aeronave", mode: "espaco", kind: "aeronave", speed: "air" }
};

/** Tipos de grupo e as funções de cada um (como no macro "Group Manager"). */
export const GROUP_TYPES = {
  "Viajantes": ["Indefinido", "Batedor", "Vigia", "Forrageador", "Rastreador", "Navegador", "Cartógrafo", "Guarda"],
  "Monstros": ["Indefinido", "Rastreador", "Bando", "Alpha", "Servo"],
  "Infantaria": ["Indefinido", "Vigia", "Linha de frente", "Oficial"],
  "Esquadrão de Ataque": ["Indefinido", "Batedor", "Vigia", "Comandante"],
  "Esquadrão de Defesa": ["Indefinido", "Guardião", "Vigia", "Comandante"],
  "Veículo: Terrestre": ["Indefinido", "Condutor", "Reparador", "Passageiro"],
  "Veículo: Aquático": ["Indefinido", "Capitão", "Timoneiro", "Contramestre", "Navegador", "Artilheiro", "Carpinteiro", "Marinheiro", "Passageiro"],
  "Veículo: Aéreo": ["Indefinido", "Condutor", "Observador", "Mecânico", "Navegador", "Passageiro"],
  "Veículo: Espacial": ["Indefinido", "Capitão", "Condutor", "Navegador", "Artilheiro", "Magicânico", "Passageiro"],
  "Animais: Presas": ["Líder", "Bando"],
  "Animais: Predadores": ["Alpha", "Bando"]
};
/** Funções que podem se repetir no mesmo grupo. */
export const ROLES_REPEAT = ["Indefinido", "Bando", "Passageiro", "Marinheiro"];
export const VEHICLE_GROUP = { land: "Veículo: Terrestre", water: "Veículo: Aquático", air: "Veículo: Aéreo", space: "Veículo: Espacial" };
/** Formações: quantas posições e onde fica cada uma (x, y de -1 a 1; a frente é para cima; 1 = quem vai na frente). */
export const FORMATIONS = {
  "Linha": Array.from({ length: 6 }, (_, i) => [-1 + 2 * i / 5, 0]),
  "Coluna": Array.from({ length: 6 }, (_, i) => [0, -1 + 2 * i / 5]),
  "Linha Dupla": [...Array.from({ length: 4 }, (_, i) => [-0.9 + 0.6 * i, -0.45]), ...Array.from({ length: 4 }, (_, i) => [-0.9 + 0.6 * i, 0.45])],
  "Cunha": [[0, -1], [-0.36, -0.33], [0.36, -0.33], [-0.68, 0.33], [0.68, 0.33], [-1, 1], [1, 1]],
  "Quadrado": Array.from({ length: 9 }, (_, i) => [-0.8 + 0.8 * (i % 3), -0.8 + 0.8 * Math.floor(i / 3)]),
  "Círculo": Array.from({ length: 8 }, (_, i) => [Math.sin(i * Math.PI / 4) * 0.9, -Math.cos(i * Math.PI / 4) * 0.9]),
  "Dispersão": [[0, -1], [-0.7, -0.75], [0.75, -0.6], [-0.25, -0.35], [0.35, -0.1], [-0.85, 0.05], [0.9, 0.25], [-0.45, 0.4], [0.2, 0.55], [-0.95, 0.85], [0.6, 0.9], [-0.1, 1]]
};

/** Quando o nome do local aparece no mapa. */
export const LABEL_MODES = { sempre: "Sempre", perto: "Só de perto (com zoom)", hover: "Ao passar o mouse", nunca: "Nunca (só no cartão)" };

/** Estilos de traço das rotas. */
export const ROUTE_DASH = { "": "Padrão do tipo", solida: "Contínua", tracejada: "Tracejada", pontilhada: "Pontilhada", tracoponto: "Traço e ponto" };
/** Estilos de ponte (na aparência de cada rota, do grupo ou do tipo). */
export const BRIDGE_STYLES = { "": "Padrão (pedra)", pedra: "Pedra", madeira: "Madeira (tábuas)", linhas: "Dois guarda-corpos", tracejado: "Guarda-corpos tracejados", rota: "Como a rota (com contorno)", nenhum: "Sem desenho" };
export const DASH_PATTERN = { solida: "none", tracejada: "10 7", pontilhada: "1.5 6", tracoponto: "12 5 2 5" };

/** Quando o cartão de clima da rosa aparece. */
export const ROSE_CARD = { sempre: "Sempre", hover: "Ao passar o mouse", clique: "Ao clicar na rosa", nunca: "Nunca" };
/** Como as nuvens aparecem. */
export const CLOUD_MODES = { auto: "Automático (pelo nível do mapa)", sombras: "Só as sombras no chão (região)", inteiras: "Nuvens inteiras vistas do alto (mundo)", nenhuma: "Sem nuvens" };

/** Natureza das regiões. */
export const NATURE_CATS = {
  fauna: { label: "Fauna", icon: "cervo", empty: "Nenhum animal registrado nesta região." },
  flora: { label: "Flora", icon: "tree", empty: "Nenhuma planta registrada nesta região." },
  ameacas: { label: "Ameaças", icon: "monstro", empty: "Nenhuma ameaça conhecida nesta região." }
};

/** Formatos do marcador de local. */
export const SHAPES = { circulo: "Círculo", hex: "Hexágono (pontas nas laterais)", hexv: "Hexágono (ponta para baixo)", escudo: "Escudo / brasão", losango: "Losango", quadrado: "Quadrado", livre: "Só a imagem" };

/** Ícones que o Mestre pode escolher para um local. */
/** Nome de cada ícone (aparece ao passar o mouse na escolha de ícones). */
export const ICON_NAMES = {"beehive": "Apiário (colmeia)", "lighthouse": "Farol", "shipyard": "Estaleiro", "pier": "Cais", "cotton": "Algodoal", "moth": "Mariposa", "cocoon": "Casulo", "lantern": "Lanterna", "chapel": "Capela", "shrine": "Santuário", "graveyard": "Cemitério", "hut": "Cabana", "huts": "Aldeia tribal", "sinkhole": "Sumidouro / fenda", "portal": "Portal onírico", "mist": "Brumas", "mushroom": "Cogumelo", "crystal": "Cristal", "forest": "Floresta", "tree": "Árvore", "mountain": "Montanha", "hill": "Colina", "cave2": "Caverna", "lake": "Lago", "sea": "Mar", "swamp": "Pântano", "desert": "Deserto", "volcano": "Vulcão", "waterfall": "Cachoeira", "island": "Ilha", "watchtower": "Torre de vigia", "farm": "Fazenda", "field": "Plantação", "windmill": "Moinho", "well": "Poço", "camp2": "Acampamento", "mercado": "Mercado", "loja": "Loja", "tesouro": "Tesouro", "saque": "Saque", "recursos": "Recursos", "espada": "Espada", "escudo": "Escudo", "monstro": "Monstro", "lobo": "Lobo", "cervo": "Cervo", "elmo": "Elmo", "rota": "Rota", "navio": "Navio", "carroca": "Carroça", "balao": "Balão", "aeronave": "Aeronave", "viajantes": "Viajantes", "capital": "Capital", "city": "Cidade", "village": "Vila", "castle": "Castelo / forte", "house": "Casa", "tower": "Torre", "temple": "Templo", "tavern": "Taverna", "shop": "Loja / edifício", "anchor": "Porto", "ship": "Barco", "tent": "Tenda", "cave": "Masmorra / caverna", "ruin": "Ruína", "skull": "Perigo", "mine": "Mina", "bridge": "Ponte", "gate": "Portão", "crown": "Coroa", "shield": "Brasão", "star": "Estrela", "eye": "Olho / mistério", "flag": "Bandeira", "district": "Distrito", "pin": "Alfinete", "horse": "Cavalo", "cart": "Carroça", "person": "Pessoa", "party": "Grupo"};
export const iconName = (n) => ICON_NAMES[n] ?? n;
export const ICON_CHOICES = ["beehive", "lighthouse", "shipyard", "pier", "cotton", "moth", "cocoon", "lantern", "chapel", "shrine", "graveyard", "hut", "huts", "sinkhole", "portal", "mist", "mushroom", "crystal", "forest", "tree", "mountain", "hill", "cave2", "lake", "sea", "swamp", "desert", "volcano", "waterfall", "island", "watchtower", "farm", "field", "windmill", "well", "camp2", "mercado", "loja", "tesouro", "saque", "recursos", "espada", "escudo", "monstro", "lobo", "cervo", "elmo", "rota", "navio", "carroca", "balao", "aeronave", "viajantes", "capital", "city", "village", "castle", "house", "tower", "temple", "tavern", "shop", "anchor", "ship", "tent", "cave", "ruin", "skull", "mine", "tree", "mountain", "bridge", "gate", "crown", "shield", "star", "eye", "flag", "district", "pin"];

/** Clima. fx = efeito do Foundry correspondente (CONFIG.weatherEffects). */
export const CLIMATES = {
  limpo: { label: "Limpo", icon: "sun", fx: "" },
  nublado: { label: "Nublado", icon: "cloud", fx: "" },
  neblina: { label: "Neblina", icon: "fogw", fx: "fog" },
  chuva: { label: "Chuva", icon: "rain", fx: "rain" },
  tempestade: { label: "Tempestade", icon: "storm", fx: "rainStorm" },
  neve: { label: "Neve", icon: "snow", fx: "snow" },
  nevasca: { label: "Nevasca", icon: "snow", fx: "blizzard" },
  calor: { label: "Calor forte", icon: "sun", fx: "" }
};
/** Clima próprio de um terreno (Região): fica sempre assim, independente do clima do mapa. */
export const ZONE_WX = {
  neblina: { label: "Névoa constante", climate: "neblina", mul: [228, 230, 234] },
  chuva: { label: "Chuva constante", climate: "chuva", mul: [205, 210, 222], rain: 1 },
  tempestade: { label: "Tempestade constante", climate: "tempestade", mul: [182, 188, 204], rain: 2, flash: true },
  neve: { label: "Neve constante", climate: "neve", mul: [226, 230, 240], snow: 1, temp: -4 },
  nevasca: { label: "Nevasca constante", climate: "nevasca", mul: [210, 216, 230], snow: 2, temp: -12 },
  frio: { label: "Frio intenso", climate: null, mul: [206, 220, 238], frost: true, temp: -10 },
  calor: { label: "Calor intenso", climate: "calor", mul: [255, 230, 196], heat: true, temp: 38 }
};
/** Escala de Beaufort: rótulo e km/h médios. */
export const BEAUFORT = [
  ["Calmaria", 0], ["Aragem", 3], ["Brisa leve", 9], ["Brisa fraca", 15], ["Brisa moderada", 24], ["Brisa forte", 34], ["Vento fresco", 44],
  ["Vento forte", 56], ["Ventania", 68], ["Ventania forte", 81], ["Tempestade", 96], ["Tempestade violenta", 110], ["Furacão", 120]
];
export const DIRS16 = ["N", "NNE", "NE", "ENE", "L", "LSE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

/* ---------- estilos de rótulo (texto no mapa) ---------- */
// font: família; w: peso; it: itálico; up: maiúsculas; sp: espaçamento entre letras (em); col: cor; ol: cor da borda; ow: espessura da borda (px); op: opacidade
export const LABEL_STYLES = {
  continente: { label: "Continente", font: "Cinzel, serif", w: 700, it: false, up: true, sp: 0.32, col: "#f3e3b8", ol: "#1b1408", ow: 3, op: 1 },
  regiao: { label: "Região", font: "Cinzel, serif", w: 600, it: true, up: true, sp: 0.18, col: "#efdcab", ol: "#21180b", ow: 2, op: 0.95 },
  mar: { label: "Mar", font: "Georgia, 'Times New Roman', serif", w: 600, it: true, up: true, sp: 0.24, col: "#cfe6ff", ol: "#08182c", ow: 2, op: 0.95 },
  rio: { label: "Rio", font: "Georgia, 'Times New Roman', serif", w: 500, it: true, up: false, sp: 0.06, col: "#bfe3ff", ol: "#0a2036", ow: 2, op: 0.95 },
  local: { label: "Local", font: "'IBM Plex Sans', system-ui, sans-serif", w: 600, it: false, up: false, sp: 0.02, col: "#ffffff", ol: "#000000", ow: 2, op: 1 },
  antigo: { label: "Pergaminho", font: "Cinzel, serif", w: 700, it: true, up: true, sp: 0.22, col: "#3c2c16", ol: "#f3e7c8", ow: 0, op: 0.7 }
};
/** Estilo final de um rótulo: o modelo escolhido com o que foi mudado à mão por cima. */
export function labelStyle(l = {}) {
  const b = LABEL_STYLES[l.style] ?? LABEL_STYLES[l.color ? "local" : "antigo"]; const n = (v, d) => (v === "" || v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  return { font: l.font || b.font, w: n(l.w, b.w), it: l.it ?? b.it, up: l.up ?? b.up, sp: n(l.sp, b.sp), col: l.color || b.col, ol: l.ol || b.ol, ow: n(l.ow, b.ow), op: n(l.op, b.op) };
}
/** CSS do rótulo (borda feita com sombras em volta das letras, que funciona em qualquer fonte). */
export function labelCss(st, fs) {
  const w = Math.max(0, st.ow) * Math.max(0.6, Math.min(1.6, fs / 22)); const sh = [];
  if (w > 0) { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; sh.push(`${(Math.cos(a) * w).toFixed(1)}px ${(Math.sin(a) * w).toFixed(1)}px 0 ${st.ol}`); } sh.push(`0 0 ${(w * 2.5).toFixed(1)}px ${st.ol}`); }
  return `font-family:${st.font};font-weight:${st.w};font-style:${st.it ? "italic" : "normal"};text-transform:${st.up ? "uppercase" : "none"};letter-spacing:${st.sp}em;color:${st.col};opacity:${st.op};${sh.length ? `text-shadow:${sh.join(",")};` : "text-shadow:none;"}`;
}
