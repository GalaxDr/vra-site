// Modelo fisico simplificado da semeadora + sensor de radar Doppler.
// Tudo em unidades SI, exceto onde indicado (km/h, kg/ha, g/s).

export const LINHAS = 12;              // linhas da semeadora
export const ESPACAMENTO = 0.5;        // m entre linhas
export const LARGURA = LINHAS * ESPACAMENTO; // 6 m de faixa
export const TALHAO_C = 200;           // comprimento do talhao (m)
export const TALHAO_L = 120;           // largura do talhao (m)
export const CELULA = 2;               // resolucao do mapa (m)
export const COLS = TALHAO_C / CELULA; // 100
export const ROWS_MAPA = TALHAO_L / CELULA; // 60

export const F0 = 24.125e9;            // CDM324 (Hz)
export const C = 299_792_458;
export const HZ_POR_MS = (2 * F0) / C; // ~160,9 Hz por m/s (na direcao do feixe)
export const CORTE_HZ = 180;           // corte de vibracao do firmware
export const ESPECTRO_MAX_HZ = 800;
export const ESPECTRO_BINS = 64;
export const K_CAL = 0.000021;          // fator K ilustrativo

export const ZONAS = [180, 240, 300, 360]; // kg/ha das zonas de manejo

const TAU_DOSADOR = 1.4;               // s, resposta do motor do dosador

export type Parametros = {
  velocidadeKmh: number;
  modo: "vra" | "fixa";
  taxaFixa: number;                    // kg/ha
  anguloGraus: number;                 // 45 ou 60
};

export type Estado = {
  x: number;
  y: number;                           // borda superior da faixa atual
  dir: 1 | -1;
  t: number;
  vazaoReal: number;                   // kg/s total (saida do dosador)
  taxaAlvo: number;                    // kg/ha
  fatorLinha: number[];                // desuniformidade natural entre linhas
  entupida: boolean[];
  nivelLinha: number[];                // 1 = livre, 0 = totalmente entupida
  medidaLinha: number[];               // g/s medido pelo radar de cada linha
  velGrao: number[];                   // m/s dos graos em cada tubo
  aplicadoKg: number;
  areaHa: number;
  mapaAplicado: Float32Array;          // kg/ha medido em cada celula (0 = vazio)
  concluido: boolean;
};

// Mapa de prescricao: campo continuo quantizado em 4 zonas
export function prescricao(x: number, y: number): number {
  const v =
    Math.sin(x / 31 + 0.7) * 0.9 +
    Math.cos(y / 21 + x / 57) * 0.8 +
    Math.sin((x + 1.6 * y) / 17) * 0.45;
  const n = (v + 2.15) / 4.3; // ~0..1
  const i = Math.max(0, Math.min(ZONAS.length - 1, Math.floor(n * ZONAS.length)));
  return ZONAS[i];
}

// Gerador pseudoaleatorio deterministico (mesma "semeadora" a cada reinicio)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function novoEstado(): Estado {
  const rnd = mulberry32(7);
  return {
    x: 0,
    y: 0,
    dir: 1,
    t: 0,
    vazaoReal: 0,
    taxaAlvo: 0,
    fatorLinha: Array.from({ length: LINHAS }, () => 0.96 + rnd() * 0.08),
    entupida: Array(LINHAS).fill(false),
    nivelLinha: Array(LINHAS).fill(1),
    medidaLinha: Array(LINHAS).fill(0),
    velGrao: Array.from({ length: LINHAS }, () => 3.0 + rnd() * 0.5),
    aplicadoKg: 0,
    areaHa: 0,
    mapaAplicado: new Float32Array(COLS * ROWS_MAPA),
    concluido: false,
  };
}

// Avanca a simulacao dt segundos (tempo simulado)
export function passo(e: Estado, p: Parametros, dt: number) {
  if (e.concluido) return;
  const v = p.velocidadeKmh / 3.6;
  e.t += dt;

  // Movimento em vai-e-vem
  e.x += e.dir * v * dt;
  if (e.x > TALHAO_C || e.x < 0) {
    e.x = e.x > TALHAO_C ? TALHAO_C : 0;
    e.dir = (e.dir * -1) as 1 | -1;
    e.y += LARGURA;
    if (e.y + LARGURA > TALHAO_L + 0.01) {
      e.concluido = true;
      e.vazaoReal = 0;
      return;
    }
  }

  // Taxa alvo pelo mapa (centro da barra) ou fixa
  e.taxaAlvo = p.modo === "vra" ? prescricao(e.x, e.y + LARGURA / 2) : p.taxaFixa;
  const alvoKgS = (e.taxaAlvo * v * LARGURA) / 10000;

  // Dosador responde com atraso de primeira ordem
  e.vazaoReal += (alvoKgS - e.vazaoReal) * (1 - Math.exp(-dt / TAU_DOSADOR));

  // Cada linha: fator proprio, entupimento progressivo e leitura do radar
  const porLinha = (e.vazaoReal * 1000) / LINHAS; // g/s
  let somaMedida = 0;
  const aMed = 1 - Math.exp(-dt / 0.35);
  for (let i = 0; i < LINHAS; i++) {
    const alvoNivel = e.entupida[i] ? 0 : 1;
    e.nivelLinha[i] += (alvoNivel - e.nivelLinha[i]) * (1 - Math.exp(-dt / 0.8));
    const real = porLinha * e.fatorLinha[i] * e.nivelLinha[i];
    const leitura = Math.max(0, real * (1 + gauss() * 0.04));
    e.medidaLinha[i] += (leitura - e.medidaLinha[i]) * aMed;
    somaMedida += e.medidaLinha[i];
  }

  // Massa aplicada (pelo sensor) e area
  e.aplicadoKg += (somaMedida / 1000) * dt;
  e.areaHa += (v * LARGURA * dt) / 10000;

  // Pinta o mapa de aplicacao: cada linha cobre 0,5 m de largura
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(e.x / CELULA)));
  for (let i = 0; i < LINHAS; i++) {
    const yi = e.y + (i + 0.5) * ESPACAMENTO;
    const row = Math.min(ROWS_MAPA - 1, Math.floor(yi / CELULA));
    const taxaLinha = v > 0 ? (e.medidaLinha[i] / 1000 / (v * ESPACAMENTO)) * 10000 : 0;
    const idx = row * COLS + col;
    // Duas linhas caem na mesma celula de 2 m: usa a media ponderada
    const atual = e.mapaAplicado[idx];
    // Linha sem adubo marca a celula de vermelho e ela nao e mais sobrescrita
    if (atual === 1) continue;
    if (e.nivelLinha[i] < 0.3) {
      e.mapaAplicado[idx] = 1;
      continue;
    }
    // Duas linhas caem na mesma celula de 2 m: media ponderada
    e.mapaAplicado[idx] = atual === 0 ? Math.max(20, taxaLinha) : atual * 0.6 + Math.max(20, taxaLinha) * 0.4;
  }
}

export function freqDoppler(velGrao: number, anguloGraus: number): number {
  return HZ_POR_MS * velGrao * Math.cos((anguloGraus * Math.PI) / 180);
}

// Espectro sintetico de uma linha (magnitude por bin), para visualizacao.
export function espectroLinha(
  gS: number,
  fd: number,
  velocidadeKmh: number,
  out: Float32Array
) {
  const binHz = ESPECTRO_MAX_HZ / ESPECTRO_BINS;
  const sigma = 38;
  // amplitude da nuvem de graos tal que K * E * f ~ g/s
  const energiaAlvo = gS > 0.05 ? gS / (K_CAL * fd) : 0;
  let somaForma = 0;
  const forma = new Float32Array(ESPECTRO_BINS);
  for (let i = 0; i < ESPECTRO_BINS; i++) {
    const f = i * binHz;
    const g = Math.exp(-0.5 * ((f - fd) / sigma) ** 2);
    forma[i] = g;
    if (f >= CORTE_HZ) somaForma += g;
  }
  const vib = 25 + velocidadeKmh * 9; // vibracao do trator cresce com a velocidade
  for (let i = 0; i < ESPECTRO_BINS; i++) {
    const f = i * binHz;
    const ruido = 6 + Math.abs(gauss()) * 5;
    const vibracao = vib * Math.exp(-f / 55) * (0.7 + Math.random() * 0.6);
    const graos = somaForma > 0 ? (forma[i] / somaForma) * energiaAlvo * (0.85 + Math.random() * 0.3) : 0;
    out[i] = ruido + vibracao + graos;
  }
}

// Mesmo processamento do firmware: tira a tara, corta abaixo de 180 Hz, centroide
export function processarEspectro(spec: Float32Array) {
  const binHz = ESPECTRO_MAX_HZ / ESPECTRO_BINS;
  const TARA = 10.5; // media do ruido de fundo medida na "tara"
  let E = 0;
  let somaF = 0;
  for (let i = 0; i < spec.length; i++) {
    const f = i * binHz;
    if (f < CORTE_HZ) continue;
    const d = spec[i] - TARA;
    if (d > 0) {
      E += d;
      somaF += d * f;
    }
  }
  const limiar = 150;
  const fluxo = E > limiar;
  const centroide = E > 0 ? somaF / E : 0;
  return { E, centroide, fluxo, gS: fluxo ? K_CAL * E * centroide : 0 };
}

// Rampa de cor para kg/ha (mapas e legenda)
const RAMPA: [number, [number, number, number]][] = [
  [150, [233, 226, 196]],
  [210, [196, 206, 160]],
  [270, [118, 160, 150]],
  [330, [57, 110, 140]],
  [390, [34, 62, 104]],
];

export function corTaxa(r: number): [number, number, number] {
  if (r <= RAMPA[0][0]) return RAMPA[0][1];
  for (let i = 1; i < RAMPA.length; i++) {
    if (r <= RAMPA[i][0]) {
      const [r0, c0] = RAMPA[i - 1];
      const [r1, c1] = RAMPA[i];
      const t = (r - r0) / (r1 - r0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return RAMPA[RAMPA.length - 1][1];
}
