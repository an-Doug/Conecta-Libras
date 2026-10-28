# Conecta Libras

PWA de comunicação em Libras (protótipo).

## Fala → Libras
- Entrada por voz (Web Speech API do navegador, `pt-BR`) ou texto digitado.
- Avatar 3D próprio feito com Three.js (carregado sob demanda), sem arquivos de modelo.
- Frases entram numa fila e são sinalizadas uma por vez; histórico salvo no aparelho (`localStorage`).

### Arquivos do avatar
- `rig.js` – esqueleto 3D simples (tronco, cabeça, braços, mãos com dedos).
- `signs.js` – vocabulário de sinais e datilologia (soletração) + conversão texto → quadros-chave.
- `avatar.js` – cena Three.js e sequenciador de animação.

### Importante
As poses de `signs.js` são **aproximações de protótipo** e precisam ser validadas por intérpretes de
Libras e pessoas surdas antes de qualquer uso real. Palavras fora do vocabulário são soletradas
(datilologia): cada letra tem curvatura dos dedos, abertura entre dedos (`sp`), polegar à frente (`tc`),
orientação do pulso (`o`) e, em J e Z, um pequeno percurso (`path`). Letras repetidas ("carro") ganham um
toque para aparecerem duas vezes. Números: só 0 a 5 (6 a 9 ainda não foram modelados). A câmera do avatar
é aproximada para a mão ficar legível.

Para adicionar um sinal: crie uma entrada em `SIGNS` (lista de quadros `{ pose, t, h }`).
Para ajustar uma letra: edite a entrada em `ALPHA` (`signs.js`).

## Libras → Texto
Câmera + MediaPipe Hands, com sinais ensinados pelo próprio usuário (kNN local).
