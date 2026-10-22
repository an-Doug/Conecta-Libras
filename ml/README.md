# Treino do reconhecedor de Libras (offline)

Treina um encoder de sequências de landmarks (mãos + ombros/braços) com landmarks públicos de
Libras e exporta o que o navegador precisa. O navegador só faz a inferência.

## Como rodar

```bash
cd ml
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 1) Teste rápido (segundos, dados sintéticos): confere o ambiente e o pipeline
python make_fake_frames.py --out fake
python train_libras.py --csv fake/frames.csv --classes fake/classes.csv --out out_fake --epochs 15

# 2) Treino real: baixa ~14 GB do Hugging Face (resumível) e guarda só MINDS-Libras + LIBRAS-UFOP em cache
python train_libras.py --out out
```

Dados: `danielelvs/multilingual-islr-mediapipe` (MIT; coordenadas derivadas do MINDS-Libras e do
LIBRAS-UFOP — mantenha as citações das bases originais). O script usa só as colunas necessárias
(mãos + 7 pontos do Pose), aplica aumento de dados (rotação, proporção da imagem, velocidade,
falhas de detecção) e valida com **sinalizantes que não aparecem no treino**.

## Saída (`out/`)

| Arquivo | Vai para o app? | O que é |
|---|---|---|
| `model/model.json` + `group1-shard*.bin` | sim | encoder em formato TF.js (float16 por padrão) |
| `refs.f32` | sim | embeddings de referência (até 30 por sinal) |
| `vocab.json` | sim | rótulos, contrato de features, limiar sugerido e métricas |
| `parity.json` | **não** | fixture para `recognizer/test/parity.test.mjs` |
| `report.json`, `cache_samples.pkl` | **não** | métricas/tamanhos e cache das amostras |

Copie `model/`, `refs.f32` e `vocab.json` para `models/libras-v1/` no projeto.

## Opções úteis

- `--epochs 60 --batch 64 --emb 128` — treino; `--quantize none` para pesos em float32.
- `--datasets minds ufop` — bases usadas (as classes com o mesmo nome são unidas).
- `--hand-order auto` — confere se `hand_0` é a mão esquerda (perto do punho 15 do Pose) e inverte se preciso.
- `--max-refs-per-class 30` — controla o tamanho de `refs.f32`.
- `--rebuild-cache` — refaz a leitura do CSV.

## Contrato de features

`train_libras.py` (seção "CONTRATO DE FEATURES") e `recognizer/features.js` precisam ser idênticos.
Depois de mudar qualquer um, treine de novo e rode o teste de paridade:

```bash
npm i -D @tensorflow/tfjs
python -m http.server 8765 --directory ml/out &
node recognizer/test/parity.test.mjs http://127.0.0.1:8765/
```

## Limitações conhecidas

- Vocabulário pequeno (20 sinais do MINDS + 56 do UFOP, se as bases forem unidas por nome).
- Reconhece **sinais isolados**, com uma pausa (mãos baixas) entre eles — não é tradução de frases.
- Proporção do vídeo do UFOP assumida como 16:9 (confirme); o aumento de dados cobre parte do erro.
- Bases gravadas em estúdio podem generalizar mal para a câmera do usuário; use o "ensinar sinal" para ajustar.
