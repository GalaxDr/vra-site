"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLS,
  CORTE_HZ,
  ESPECTRO_BINS,
  ESPECTRO_MAX_HZ,
  LARGURA,
  LINHAS,
  ROWS_MAPA,
  TALHAO_C,
  TALHAO_L,
  ZONAS,
  corTaxa,
  espectroLinha,
  freqDoppler,
  novoEstado,
  passo,
  prescricao,
  processarEspectro,
  type Estado,
  type Parametros,
} from "@/lib/simulacao";

const PX_M = 4; // pixels por metro no mapa
const MAPA_W = TALHAO_C * PX_M;
const MAPA_H = TALHAO_L * PX_M;
const TUBO_W = 240;
const TUBO_H = 360;
const ESP_W = 560;
const ESP_H = 210;
const ESCALAS = [1, 10, 30, 60];
const HIST_W = 260;
const HIST_H = 120;
const HIST_N = 160;

type Leitura = {
  velocidade: number;
  taxaAlvo: number;
  taxaMedida: number;
  vazaoKgMin: number;
  linhaGs: number;
  fd: number;
  energia: number;
  centroide: number;
  areaHa: number;
  aplicadoKg: number;
  linhas: number[];
  esperadoLinha: number;
  concluido: boolean;
  alarmes: number[];
};

type Grao = { x: number; y: number; v: number; cor: string; r: number };

const CORES_GRAO = ["#5d7fa6", "#8a93a0", "#c98f8a", "#6f8fb5", "#a7aeb8"];

function prepararCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const fmt = (n: number, d = 0) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function Simulador() {
  const mapaRef = useRef<HTMLCanvasElement>(null);
  const tuboRef = useRef<HTMLCanvasElement>(null);
  const espRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<HTMLCanvasElement>(null);

  const estadoRef = useRef<Estado>(novoEstado());
  const [params, setParams] = useState<Parametros>({
    velocidadeKmh: 7,
    modo: "vra",
    taxaFixa: 270,
    anguloGraus: 45,
  });
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [rodando, setRodando] = useState(true);
  const rodandoRef = useRef(rodando);
  rodandoRef.current = rodando;

  const [escala, setEscala] = useState(30);
  const escalaRef = useRef(escala);
  escalaRef.current = escala;

  const [linhaSel, setLinhaSel] = useState(4);
  const linhaSelRef = useRef(linhaSel);
  linhaSelRef.current = linhaSel;

  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [entupidas, setEntupidas] = useState<boolean[]>(Array(LINHAS).fill(false));

  // Respeita "reduzir movimento": comeca pausado
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRodando(false);
  }, []);

  const reiniciar = useCallback(() => {
    estadoRef.current = novoEstado();
    setEntupidas(Array(LINHAS).fill(false));
    setRodando(true);
  }, []);

  const alternarEntupimento = useCallback((i: number) => {
    const e = estadoRef.current;
    e.entupida[i] = !e.entupida[i];
    setEntupidas([...e.entupida]);
  }, []);

  useEffect(() => {
    const mapa = mapaRef.current!;
    const tubo = tuboRef.current!;
    const esp = espRef.current!;
    const ctxM = prepararCanvas(mapa, MAPA_W, MAPA_H);
    const ctxT = prepararCanvas(tubo, TUBO_W, TUBO_H);
    const ctxE = prepararCanvas(esp, ESP_W, ESP_H);
    const ctxH = prepararCanvas(histRef.current!, HIST_W, HIST_H);
    const historico: { alvo: number; med: number }[] = [];

    const desenharHistorico = () => {
      ctxH.clearRect(0, 0, HIST_W, HIST_H);
      const yDe = (v: number) => HIST_H - 14 - ((v - 120) / (420 - 120)) * (HIST_H - 22);
      ctxH.strokeStyle = "rgba(233,236,239,0.08)";
      ctxH.fillStyle = "rgba(233,236,239,0.45)";
      ctxH.font = "10px 'IBM Plex Mono', monospace";
      for (const z of [180, 300]) {
        const y = Math.round(yDe(z)) + 0.5;
        ctxH.beginPath();
        ctxH.moveTo(28, y);
        ctxH.lineTo(HIST_W, y);
        ctxH.stroke();
        ctxH.fillText(String(z), 0, y + 3);
      }
      const n = historico.length;
      const dx = (HIST_W - 30) / (HIST_N - 1);
      const traco = (campo: "alvo" | "med", cor: string, larg: number, tracejado: boolean) => {
        ctxH.strokeStyle = cor;
        ctxH.lineWidth = larg;
        ctxH.setLineDash(tracejado ? [4, 3] : []);
        ctxH.beginPath();
        historico.forEach((h, k) => {
          const x = 30 + (HIST_N - n + k) * dx;
          const y = yDe(Math.max(120, Math.min(420, h[campo])));
          if (k === 0) ctxH.moveTo(x, y);
          else ctxH.lineTo(x, y);
        });
        ctxH.stroke();
        ctxH.setLineDash([]);
      };
      if (n > 1) {
        traco("alvo", "rgba(233,236,239,0.6)", 1.2, true);
        traco("med", "#d9a21b", 2, false);
      }
    };

    // Camada de prescricao (fixa) e camada de aplicacao (atualizada)
    const presc = document.createElement("canvas");
    presc.width = COLS;
    presc.height = ROWS_MAPA;
    const pctx = presc.getContext("2d")!;
    const pimg = pctx.createImageData(COLS, ROWS_MAPA);
    for (let r = 0; r < ROWS_MAPA; r++) {
      for (let c = 0; c < COLS; c++) {
        const [R, G, B] = corTaxa(prescricao(c * 2 + 1, r * 2 + 1));
        const k = (r * COLS + c) * 4;
        pimg.data[k] = R;
        pimg.data[k + 1] = G;
        pimg.data[k + 2] = B;
        pimg.data[k + 3] = 255;
      }
    }
    pctx.putImageData(pimg, 0, 0);

    const apl = document.createElement("canvas");
    apl.width = COLS;
    apl.height = ROWS_MAPA;
    const actx = apl.getContext("2d")!;
    const aimg = actx.createImageData(COLS, ROWS_MAPA);

    const graos: Grao[] = [];
    const espectro = new Float32Array(ESPECTRO_BINS);
    let acumGraos = 0;
    let ultimo = performance.now();
    let ultimoUi = 0;
    let fase = 0;
    let proc = { E: 0, centroide: 0, fluxo: false, gS: 0 };
    let raf = 0;

    const desenharMapa = (e: Estado) => {
      ctxM.imageSmoothingEnabled = false;
      ctxM.fillStyle = "#5b4a39";
      ctxM.fillRect(0, 0, MAPA_W, MAPA_H);
      ctxM.globalAlpha = 0.42;
      ctxM.drawImage(presc, 0, 0, MAPA_W, MAPA_H);
      ctxM.globalAlpha = 1;

      for (let i = 0; i < e.mapaAplicado.length; i++) {
        const v = e.mapaAplicado[i];
        const k = i * 4;
        if (v > 0) {
          const [R, G, B] = v < 20 ? [176, 46, 38] : corTaxa(v);
          aimg.data[k] = R;
          aimg.data[k + 1] = G;
          aimg.data[k + 2] = B;
          aimg.data[k + 3] = 255;
        } else {
          aimg.data[k + 3] = 0;
        }
      }
      actx.putImageData(aimg, 0, 0);
      ctxM.drawImage(apl, 0, 0, MAPA_W, MAPA_H);

      // Grade de 20 m
      ctxM.strokeStyle = "rgba(255,255,255,0.08)";
      ctxM.lineWidth = 1;
      for (let x = 0; x <= TALHAO_C; x += 20) {
        ctxM.beginPath();
        ctxM.moveTo(x * PX_M + 0.5, 0);
        ctxM.lineTo(x * PX_M + 0.5, MAPA_H);
        ctxM.stroke();
      }
      for (let y = 0; y <= TALHAO_L; y += 20) {
        ctxM.beginPath();
        ctxM.moveTo(0, y * PX_M + 0.5);
        ctxM.lineTo(MAPA_W, y * PX_M + 0.5);
        ctxM.stroke();
      }

      if (e.concluido) return;

      // Trator + semeadora (vista de cima)
      const px = e.x * PX_M;
      const y0 = e.y * PX_M;
      const yc = y0 + (LARGURA * PX_M) / 2;
      const d = e.dir;
      ctxM.save();
      ctxM.translate(px, yc);
      ctxM.scale(d, 1);
      // engate
      ctxM.strokeStyle = "#1d1f1a";
      ctxM.lineWidth = 2;
      ctxM.beginPath();
      ctxM.moveTo(0, 0);
      ctxM.lineTo(12, 0);
      ctxM.stroke();
      // trator
      ctxM.fillStyle = "#1d1f1a";
      ctxM.fillRect(13, -9, 6, 4);
      ctxM.fillRect(13, 5, 6, 4);
      ctxM.fillRect(27, -7, 4, 3);
      ctxM.fillRect(27, 4, 4, 3);
      ctxM.fillStyle = "#d9a21b";
      ctxM.fillRect(12, -5, 22, 10);
      ctxM.fillStyle = "#2a2c27";
      ctxM.fillRect(15, -4, 7, 8);
      // barra da semeadora
      const meia = (LARGURA * PX_M) / 2;
      ctxM.fillStyle = "#e9ecef";
      ctxM.fillRect(-3, -meia - 1, 4, LARGURA * PX_M + 2);
      for (let i = 0; i < LINHAS; i++) {
        const yi = -meia + (i + 0.5) * (LARGURA * PX_M) / LINHAS;
        ctxM.fillStyle = e.entupida[i] ? "#e5484d" : "#2a2c27";
        ctxM.fillRect(-5, yi - 0.8, 3, 1.6);
      }
      ctxM.restore();
    };

    const desenharTubo = (e: Estado, dtReal: number) => {
      const p = paramsRef.current;
      const i = linhaSelRef.current;
      const gS = e.medidaLinha[i];
      const vg = e.velGrao[i];
      const tx0 = 70;
      const tx1 = 130;

      ctxT.clearRect(0, 0, TUBO_W, TUBO_H);

      // parede do tubo
      ctxT.fillStyle = "rgba(233,236,239,0.06)";
      ctxT.fillRect(tx0, 0, tx1 - tx0, TUBO_H);
      ctxT.strokeStyle = "rgba(233,236,239,0.5)";
      ctxT.lineWidth = 2;
      ctxT.beginPath();
      ctxT.moveTo(tx0, 0);
      ctxT.lineTo(tx0, TUBO_H);
      ctxT.moveTo(tx1, 0);
      ctxT.lineTo(tx1, TUBO_H);
      ctxT.stroke();

      // sensor no lado de fora, inclinado
      const sx = tx1 + 52;
      const sy = 205;
      const ang = (p.anguloGraus * Math.PI) / 180;
      // direcao do feixe: para dentro do tubo, contra a queda (para cima)
      const bx = -Math.sin(ang);
      const by = -Math.cos(ang);
      const alcance = 120;
      const abertura = 0.32;

      // cone do feixe
      ctxT.save();
      ctxT.beginPath();
      ctxT.moveTo(sx, sy);
      const a0 = Math.atan2(by, bx);
      ctxT.arc(sx, sy, alcance, a0 - abertura, a0 + abertura);
      ctxT.closePath();
      ctxT.fillStyle = "rgba(217,162,27,0.09)";
      ctxT.fill();
      // frentes de onda
      if (rodandoRef.current) fase = (fase + dtReal * 1.6) % 1;
      for (let k = 0; k < 4; k++) {
        const r = ((k + fase) / 4) * alcance;
        ctxT.beginPath();
        ctxT.arc(sx, sy, r, a0 - abertura, a0 + abertura);
        ctxT.strokeStyle = `rgba(217,162,27,${0.55 * (1 - r / alcance)})`;
        ctxT.lineWidth = 1.5;
        ctxT.stroke();
      }
      ctxT.restore();

      // corpo do sensor
      ctxT.save();
      ctxT.translate(sx, sy);
      ctxT.rotate(a0 + Math.PI / 2);
      ctxT.fillStyle = "#2a2c27";
      ctxT.strokeStyle = "#d9a21b";
      ctxT.lineWidth = 1.5;
      ctxT.fillRect(-16, 0, 32, 22);
      ctxT.strokeRect(-16, 0, 32, 22);
      ctxT.fillStyle = "#d9a21b";
      ctxT.fillRect(-12, -2, 24, 3);
      ctxT.restore();

      // angulo
      ctxT.fillStyle = "rgba(233,236,239,0.7)";
      ctxT.font = "12px 'IBM Plex Mono', monospace";
      ctxT.fillText(`${p.anguloGraus}°`, sx + 16, sy + 34);

      // graos (camera lenta 4x)
      if (rodandoRef.current) {
        acumGraos += gS * 1.6 * dtReal;
        while (acumGraos >= 1) {
          acumGraos -= 1;
          if (graos.length < 260) {
            graos.push({
              x: tx0 + 6 + Math.random() * (tx1 - tx0 - 12),
              y: -4,
              v: vg * 34 * (0.85 + Math.random() * 0.3),
              cor: CORES_GRAO[(Math.random() * CORES_GRAO.length) | 0],
              r: 1.6 + Math.random() * 1.3,
            });
          }
        }
        for (const g of graos) {
          g.y += g.v * dtReal;
          g.v += 2.5 * dtReal;
          g.x += (Math.random() - 0.5) * 0.4;
        }
        for (let k = graos.length - 1; k >= 0; k--) if (graos[k].y > TUBO_H + 4) graos.splice(k, 1);
      }
      for (const g of graos) {
        // grao dentro do feixe recebe brilho (eco)
        const dx = g.x - sx;
        const dy = g.y - sy;
        const dist = Math.hypot(dx, dy);
        const angG = Math.atan2(dy, dx);
        let dA = Math.abs(angG - a0);
        if (dA > Math.PI) dA = 2 * Math.PI - dA;
        const noFeixe = dist < alcance && dA < abertura;
        ctxT.beginPath();
        ctxT.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        ctxT.fillStyle = noFeixe ? "#ffd166" : g.cor;
        ctxT.fill();
      }

      if (e.entupida[i] && gS < 1) {
        ctxT.fillStyle = "#e5484d";
        ctxT.font = "600 13px 'Archivo Variable', sans-serif";
        ctxT.fillText("Sem fluxo", tx1 + 10, 40);
      }
    };

    const desenharEspectro = () => {
      const binHz = ESPECTRO_MAX_HZ / ESPECTRO_BINS;
      const padL = 8;
      const padB = 24;
      const w = ESP_W - padL * 2;
      const h = ESP_H - padB - 10;
      const bw = w / ESPECTRO_BINS;
      ctxE.clearRect(0, 0, ESP_W, ESP_H);

      let max = 400;
      for (let i = 0; i < ESPECTRO_BINS; i++) max = Math.max(max, espectro[i]);

      // regiao cortada
      const xCorte = padL + (CORTE_HZ / binHz) * bw;
      ctxE.fillStyle = "rgba(233,236,239,0.04)";
      ctxE.fillRect(padL, 10, xCorte - padL, h);

      for (let i = 0; i < ESPECTRO_BINS; i++) {
        const f = i * binHz;
        const v = Math.sqrt(espectro[i] / max); // escala raiz para ver o ruido
        const bh = v * h;
        ctxE.fillStyle = f < CORTE_HZ ? "rgba(233,236,239,0.28)" : "#d9a21b";
        ctxE.fillRect(padL + i * bw + 0.5, 10 + h - bh, bw - 1.5, bh);
      }

      ctxE.strokeStyle = "rgba(233,236,239,0.45)";
      ctxE.setLineDash([3, 3]);
      ctxE.beginPath();
      ctxE.moveTo(xCorte, 10);
      ctxE.lineTo(xCorte, 10 + h);
      ctxE.stroke();
      ctxE.setLineDash([]);

      if (proc.fluxo && proc.centroide > 0) {
        const xc = padL + (proc.centroide / binHz) * bw;
        ctxE.strokeStyle = "#f4f1e8";
        ctxE.lineWidth = 1.5;
        ctxE.beginPath();
        ctxE.moveTo(xc, 10);
        ctxE.lineTo(xc, 10 + h);
        ctxE.stroke();
        ctxE.fillStyle = "#f4f1e8";
        ctxE.font = "12px 'IBM Plex Mono', monospace";
        const txt = `centroide ${fmt(proc.centroide)} Hz`;
        const tw = ctxE.measureText(txt).width;
        ctxE.fillText(txt, Math.min(xc + 6, ESP_W - tw - 4), 24);
      }

      ctxE.fillStyle = "rgba(233,236,239,0.55)";
      ctxE.font = "11px 'IBM Plex Mono', monospace";
      for (let f = 0; f <= ESPECTRO_MAX_HZ; f += 200) {
        const x = padL + (f / binHz) * bw;
        ctxE.fillText(`${f}`, Math.min(x, ESP_W - 26), ESP_H - 8);
      }
      ctxE.fillText("corte 180 Hz", 12, 24);
    };

    const quadro = (agora: number) => {
      const dtReal = Math.max(0, Math.min(0.05, (agora - ultimo) / 1000));
      ultimo = agora;
      const e = estadoRef.current;
      const p = paramsRef.current;

      if (rodandoRef.current && !e.concluido) {
        const dtSim = dtReal * escalaRef.current;
        const sub = Math.ceil(dtSim / 0.05);
        for (let k = 0; k < sub; k++) passo(e, p, dtSim / sub);
      }

      const i = linhaSelRef.current;
      const fd = freqDoppler(e.velGrao[i], p.anguloGraus);
      if (rodandoRef.current) {
        espectroLinha(e.medidaLinha[i], fd, e.concluido ? 0 : p.velocidadeKmh, espectro);
        proc = processarEspectro(espectro);
      }

      desenharMapa(e);
      desenharTubo(e, dtReal);
      desenharEspectro();

      if (agora - ultimoUi > 180) {
        ultimoUi = agora;
        const v = p.velocidadeKmh / 3.6;
        const soma = e.medidaLinha.reduce((a, b) => a + b, 0);
        const esperado = e.concluido ? 0 : ((e.taxaAlvo * v * LARGURA) / 10000) * 1000 / LINHAS;
        const media = soma / LINHAS;
        if (rodandoRef.current && !e.concluido && v > 0) {
          historico.push({ alvo: e.taxaAlvo, med: (soma / 1000 / (v * LARGURA)) * 10000 });
          if (historico.length > HIST_N) historico.shift();
        }
        desenharHistorico();
        setLeitura({
          velocidade: p.velocidadeKmh,
          taxaAlvo: e.concluido ? 0 : e.taxaAlvo,
          taxaMedida: v > 0 && !e.concluido ? (soma / 1000 / (v * LARGURA)) * 10000 : 0,
          vazaoKgMin: (soma / 1000) * 60,
          linhaGs: proc.gS,
          fd: proc.fluxo ? proc.centroide : 0,
          energia: proc.E,
          centroide: proc.centroide,
          areaHa: e.areaHa,
          aplicadoKg: e.aplicadoKg,
          linhas: [...e.medidaLinha],
          esperadoLinha: esperado,
          concluido: e.concluido,
          alarmes: e.medidaLinha
            .map((m, k) => (media > 2 && m < media * 0.4 ? k : -1))
            .filter((k) => k >= 0),
        });
      }

      raf = requestAnimationFrame(quadro);
    };

    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
  }, []);

  const L = leitura;
  const erro =
    L && L.taxaAlvo > 0 ? ((L.taxaMedida - L.taxaAlvo) / L.taxaAlvo) * 100 : 0;
  const maxBarra = Math.max(1, (L?.esperadoLinha ?? 1) * 1.35);

  return (
    <div className="sim">
      <div className="sim-controles" role="group" aria-label="Controles da simulação">
        <button className="btn btn-forte" onClick={() => setRodando((r) => !r)}>
          {rodando ? "Pausar" : "Continuar"}
        </button>
        <button className="btn" onClick={reiniciar}>
          Reiniciar talhão
        </button>

        <label className="ctl">
          <span>Velocidade</span>
          <input
            type="range"
            min={4}
            max={12}
            step={0.5}
            value={params.velocidadeKmh}
            onChange={(ev) => setParams({ ...params, velocidadeKmh: +ev.target.value })}
          />
          <output>{fmt(params.velocidadeKmh, 1)} km/h</output>
        </label>

        <div className="ctl">
          <span>Aplicação</span>
          <div className="seg">
            <button
              aria-pressed={params.modo === "vra"}
              onClick={() => setParams({ ...params, modo: "vra" })}
            >
              Taxa variável
            </button>
            <button
              aria-pressed={params.modo === "fixa"}
              onClick={() => setParams({ ...params, modo: "fixa" })}
            >
              Taxa fixa
            </button>
          </div>
        </div>

        {params.modo === "fixa" && (
          <label className="ctl">
            <span>Dose</span>
            <input
              type="range"
              min={150}
              max={400}
              step={10}
              value={params.taxaFixa}
              onChange={(ev) => setParams({ ...params, taxaFixa: +ev.target.value })}
            />
            <output>{params.taxaFixa} kg/ha</output>
          </label>
        )}

        <div className="ctl">
          <span>Ângulo do sensor</span>
          <div className="seg">
            {[45, 60].map((a) => (
              <button
                key={a}
                aria-pressed={params.anguloGraus === a}
                onClick={() => setParams({ ...params, anguloGraus: a })}
              >
                {a}°
              </button>
            ))}
          </div>
        </div>

        <div className="ctl">
          <span>Tempo</span>
          <div className="seg">
            {ESCALAS.map((s) => (
              <button key={s} aria-pressed={escala === s} onClick={() => setEscala(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sim-grade">
        <figure className="painel painel-mapa">
          <figcaption>
            <span>Talhão de {TALHAO_C} × {TALHAO_L} m, semeadora de {LINHAS} linhas</span>
            <span className="legenda">
              {ZONAS.map((z) => {
                const [r, g, b] = corTaxa(z);
                return (
                  <i key={z} style={{ background: `rgb(${r},${g},${b})` }}>
                    {z}
                  </i>
                );
              })}
              <em>kg/ha</em>
            </span>
          </figcaption>
          <canvas
            ref={mapaRef}
            className="cv-mapa"
            role="img"
            aria-label="Mapa do talhão: zonas de prescrição ao fundo e faixa já adubada colorida pela dose medida pelo sensor"
          />
          <p className="nota">
            Ao fundo, o mapa de prescrição. A faixa colorida atrás do trator é a dose que os
            sensores mediram, em kg/ha. Faixas vermelhas indicam linhas sem adubo.
          </p>
        </figure>

        <aside className="painel painel-monitor" aria-live="off">
          <div className="monitor-tela">
            <div className="m-linha m-destaque">
              <span>Dose medida</span>
              <strong>{L ? fmt(L.taxaMedida) : "—"}</strong>
              <small>kg/ha</small>
            </div>
            <div className="m-linha">
              <span>Dose alvo</span>
              <strong>{L ? fmt(L.taxaAlvo) : "—"}</strong>
              <small>kg/ha</small>
            </div>
            <div className="m-linha">
              <span>Desvio</span>
              <strong className={Math.abs(erro) > 8 ? "ruim" : ""}>
                {L && L.taxaAlvo > 0 ? `${erro > 0 ? "+" : ""}${fmt(erro, 1)}` : "—"}
              </strong>
              <small>%</small>
            </div>
            <div className="m-linha">
              <span>Vazão total</span>
              <strong>{L ? fmt(L.vazaoKgMin, 2) : "—"}</strong>
              <small>kg/min</small>
            </div>
            <div className="m-linha">
              <span>Área</span>
              <strong>{L ? fmt(L.areaHa, 2) : "—"}</strong>
              <small>ha</small>
            </div>
            <div className="m-linha">
              <span>Adubo aplicado</span>
              <strong>{L ? fmt(L.aplicadoKg, 1) : "—"}</strong>
              <small>kg</small>
            </div>
          </div>

          <div className="historico">
            <p>
              <span className="chave chave-med" /> medida <span className="chave chave-alvo" /> alvo,
              últimos ~30 s
            </p>
            <canvas
              ref={histRef}
              className="cv-hist"
              role="img"
              aria-label="Gráfico da dose medida acompanhando a dose alvo ao longo do tempo"
            />
          </div>

          <div className={`alarme ${L && L.alarmes.length ? "ativo" : ""}`} role="status">
            {L?.concluido
              ? "Talhão concluído. Use Reiniciar talhão para rodar de novo."
              : L && L.alarmes.length
                ? `Linha ${L.alarmes.map((a) => a + 1).join(", ")} sem fluxo: verifique entupimento.`
                : "Todas as linhas com fluxo."}
          </div>
        </aside>

        <section className="painel painel-linhas" aria-label="Fluxo por linha">
          <header>
            <h3>Fluxo por linha</h3>
            <p>Escolha uma linha para ver o tubo e o espectro dela.</p>
          </header>
          <div className="barras">
            {Array.from({ length: LINHAS }, (_, i) => {
              const v = L?.linhas[i] ?? 0;
              const alarme = L?.alarmes.includes(i);
              return (
                <button
                  key={i}
                  className={`barra ${linhaSel === i ? "sel" : ""} ${alarme ? "alarme" : ""}`}
                  onClick={() => setLinhaSel(i)}
                  aria-pressed={linhaSel === i}
                  aria-label={`Linha ${i + 1}: ${fmt(v, 1)} gramas por segundo`}
                >
                  <span className="barra-trilho">
                    <span
                      className="barra-valor"
                      style={{ height: `${Math.min(100, (v / maxBarra) * 100)}%` }}
                    />
                  </span>
                  <span className="barra-num">{i + 1}</span>
                </button>
              );
            })}
          </div>
          <button
            className={`btn ${entupidas[linhaSel] ? "btn-alerta" : ""}`}
            onClick={() => alternarEntupimento(linhaSel)}
          >
            {entupidas[linhaSel]
              ? `Desentupir linha ${linhaSel + 1}`
              : `Entupir linha ${linhaSel + 1}`}
          </button>
        </section>

        <figure className="painel painel-tubo">
          <figcaption>
            <span>Tubo da linha {linhaSel + 1}</span>
            <span className="mono">câmera lenta</span>
          </figcaption>
          <canvas
            ref={tuboRef}
            className="cv-tubo"
            role="img"
            aria-label="Grãos de adubo caindo no tubo, atravessados pelo feixe do radar instalado do lado de fora"
          />
          <p className="nota">
            O radar fica do lado de fora do tubo plástico. Os grânulos que cruzam o feixe
            devolvem o eco com a frequência deslocada.
          </p>
        </figure>

        <figure className="painel painel-espectro">
          <figcaption>
            <span>Espectro FFT da linha {linhaSel + 1}</span>
            <span className="mono">0 a {ESPECTRO_MAX_HZ} Hz</span>
          </figcaption>
          <canvas
            ref={espRef}
            className="cv-esp"
            role="img"
            aria-label="Espectro de frequências do sinal do radar, com a região abaixo de 180 Hz descartada"
          />
          <dl className="calc">
            <div>
              <dt>Energia útil E</dt>
              <dd>{L ? fmt(L.energia) : "—"}</dd>
            </div>
            <div>
              <dt>Frequência f</dt>
              <dd>{L && L.fd > 0 ? `${fmt(L.fd)} Hz` : "—"}</dd>
            </div>
            <div>
              <dt>Vazão = K · E · f</dt>
              <dd>{L ? `${fmt(L.linhaGs, 1)} g/s` : "—"}</dd>
            </div>
          </dl>
        </figure>
      </div>
    </div>
  );
}
