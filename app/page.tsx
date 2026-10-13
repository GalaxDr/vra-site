import Simulador from "@/components/Simulador";

const etapas = [
  {
    titulo: "O radar ilumina o tubo",
    texto:
      "O módulo CDM324 emite micro-ondas de 24 GHz. Instalado do lado de fora do tubo, inclinado entre 45° e 60°, o feixe atravessa a parede plástica sem contato com o adubo.",
  },
  {
    titulo: "Os grânulos devolvem o eco deslocado",
    texto:
      "Cada grânulo em queda reflete a onda com a frequência alterada pelo efeito Doppler. A cada 1 m/s de velocidade, o desvio é de cerca de 161 Hz, multiplicado pelo cosseno do ângulo. A 45°, grãos a 3,2 m/s aparecem perto de 364 Hz.",
  },
  {
    titulo: "A FFT separa grão de vibração",
    texto:
      "O ESP32-S3 amostra o sinal amplificado pelo MAX9814 e calcula uma FFT de 256 pontos com janela de Hann. Tudo abaixo de 180 Hz é descartado, porque ali ficam as vibrações do trator e do solo. O ruído de fundo medido na tara é subtraído bin a bin.",
  },
  {
    titulo: "A energia do espectro vira massa",
    texto:
      "A energia útil E indica quantos grânulos passam, e a frequência do centroide f indica a velocidade deles. A vazão é K · E · f, com o fator K ajustado em bancada pesando amostras despejadas em tempo controlado.",
  },
];

const hardware = [
  ["Radar", "CDM324, 24 GHz", "Emite e recebe as micro-ondas; a saída IF carrega o sinal Doppler."],
  ["Pré-amplificador", "MAX9814", "Eleva o sinal de microvolts. Ganho de 40 dB, abaixo do limiar do controle automático de ganho, para manter a resposta linear."],
  ["Processador", "ESP32-S3, dois núcleos", "ADC com DMA, FFT acelerada e cálculo da vazão de cada linha."],
  ["Montagem", "Colar externo a 45°–60°", "Preso ao tubo plástico da semeadora, sem peças em contato com o fertilizante."],
  ["Invólucro", "IP67", "Protege contra pó de adubo, umidade e lavagem da máquina."],
];

const marcos = [
  {
    estado: "Concluído",
    titulo: "Protótipo com HW-MS03",
    texto:
      "Radar de 3,2 GHz com ESP32 Wemos D1 R32. Validou a cadeia completa: FFT, tara espectral, centroide, retenção de micro-vazios e envio por Bluetooth.",
  },
  {
    estado: "Em andamento",
    titulo: "Bancada com Cardputer ADV",
    texto:
      "Monitor portátil com espectro ao vivo na tela e tarefas divididas entre os dois núcleos. Serve para medir a faixa real de frequência dos grãos e calibrar o fator K.",
  },
  {
    estado: "Próximo",
    titulo: "CDM324 + MAX9814",
    texto:
      "Medição através da parede do tubo a 24 GHz, ajuste de ganho do pré-amplificador e testes de linearidade em vazões altas.",
  },
  {
    estado: "Depois",
    titulo: "Campo",
    texto:
      "Validação sob vibração real da semeadora, invólucro IP67 e integração com o monitor de bordo e o mapa de prescrição.",
  },
];

export default function Home() {
  return (
    <>
      <header className="topo">
        <a href="#" className="marca">
          Radar VRA
        </a>
        <nav aria-label="Seções">
          <a href="#simulacao">Simulação</a>
          <a href="#funcionamento">Como funciona</a>
          <a href="#hardware">Hardware</a>
          <a href="#andamento">Andamento</a>
        </nav>
      </header>

      <main>
        <section className="abertura">
          <h1>Medir o adubo que cai, sem tocar nele.</h1>
          <p className="lead">
            Um sensor de radar Doppler preso do lado de fora do tubo da semeadora mede, linha a
            linha, quanto fertilizante está passando. O monitor compara com o mapa de
            prescrição e avisa na hora quando uma linha entope.
          </p>
        </section>

        <section id="simulacao" className="secao-sim" aria-label="Simulação interativa">
          <Simulador />
          <p className="aviso">
            Simulação ilustrativa. Os valores vêm de um modelo físico simplificado, não de
            medições do sensor.
          </p>
        </section>

        <section id="funcionamento" className="secao">
          <h2>Como a medição funciona</h2>
          <ol className="etapas">
            {etapas.map((e) => (
              <li key={e.titulo}>
                <h3>{e.titulo}</h3>
                <p>{e.texto}</p>
              </li>
            ))}
          </ol>

          <div className="formulas">
            <div>
              <p className="formula">
                f<sub>d</sub> = 2 · v · cos θ · f<sub>0</sub> / c
              </p>
              <p>Desvio Doppler para grãos a velocidade v, com o feixe a θ do eixo do tubo.</p>
            </div>
            <div>
              <p className="formula">ṁ = K · E · f</p>
              <p>Vazão mássica em g/s a partir da energia útil e da frequência do centroide.</p>
            </div>
            <div>
              <p className="formula">kg/min = g/s · 60 / 1000</p>
              <p>Taxa de aplicação mostrada ao operador.</p>
            </div>
          </div>
        </section>

        <section id="hardware" className="secao">
          <h2>Hardware</h2>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Parte</th>
                  <th scope="col">Componente</th>
                  <th scope="col">Papel</th>
                </tr>
              </thead>
              <tbody>
                {hardware.map(([parte, comp, papel]) => (
                  <tr key={parte}>
                    <th scope="row">{parte}</th>
                    <td>{comp}</td>
                    <td>{papel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="sub">Firmware em dois núcleos</h3>
          <div className="nucleos">
            <div>
              <h4>Núcleo 0: medição</h4>
              <ul>
                <li>Amostragem do ADC por DMA</li>
                <li>FFT de 256 pontos com janela de Hann</li>
                <li>Corte abaixo de 180 Hz e tara do ruído</li>
                <li>Limiar de magnitude contra a nuvem de pó</li>
                <li>Vazão por linha e massa acumulada</li>
              </ul>
            </div>
            <div>
              <h4>Núcleo 1: operador</h4>
              <ul>
                <li>Tela e teclado do monitor</li>
                <li>Comparação com o mapa de prescrição</li>
                <li>Alarme de linha entupida</li>
                <li>Bluetooth e registro dos dados</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="andamento" className="secao">
          <h2>Andamento</h2>
          <ol className="marcos">
            {marcos.map((m) => (
              <li key={m.titulo} data-estado={m.estado}>
                <span className="estado">{m.estado}</span>
                <h3>{m.titulo}</h3>
                <p>{m.texto}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="rodape">
        <p>Radar VRA, sensor de vazão de fertilizante por radar Doppler.</p>
        <p>Projeto em desenvolvimento.</p>
      </footer>
    </>
  );
}
