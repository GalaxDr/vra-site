# Radar VRA – site do projeto

Site em Next.js que apresenta o sensor de vazão de adubo por radar Doppler, com uma
simulação interativa de uma semeadora aplicando fertilizante a taxa variável.

## Rodar no computador

Precisa do Node.js 18.18 ou mais novo.

```bash
npm install
npm run dev
```

Abra http://localhost:3000.

## Publicar

O jeito mais simples é a Vercel: suba a pasta para um repositório no GitHub e importe
em vercel.com (detecta Next.js sozinha). Para gerar a versão de produção localmente:

```bash
npm run build
npm start
```

## Onde mexer

- `app/page.tsx`: textos das seções (como funciona, hardware, andamento).
- `components/Simulador.tsx`: simulação (mapa, monitor, tubo, espectro).
- `lib/simulacao.ts`: modelo físico (linhas, espaçamento, zonas do mapa,
  frequência do radar, corte de 180 Hz, fator K).
- `app/globals.css`: cores e tipografia.

Os valores da simulação vêm de um modelo simplificado, não de medições do sensor.
