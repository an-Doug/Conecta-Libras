# Conecta Libras

PWA de comunicação em Libras (protótipo).

## Fala → Libras
- Entrada por voz (Web Speech API do navegador, `pt-BR`) ou texto digitado.
- Avatar 3D próprio feito com Three.js (carregado sob demanda), sem arquivos de modelo.
- Frases entram numa fila e são sinalizadas uma por vez; histórico salvo no aparelho (`localStorage`).

### Arquivos do avatar
- `rig.js` – esqueleto 3D do personagem (estilo cartoon: cabelo, olhos, traje azul com emblema, capa curta, mãos grandes com dedos). Só primitivas; o emblema é desenhado num canvas. Contrato com `avatar.js`: `buildRig(THREE) → { root, torso, head, apply(pose), idle(now) }`.
- `signs.js` – vocabulário de sinais e datilologia (soletração) + conversão texto → quadros-chave.
- `avatar.js` – cena Three.js e sequenciador de animação.

### Importante
As poses de `signs.js` são **aproximações de protótipo** e precisam ser validadas por intérpretes de
Libras e pessoas surdas antes de qualquer uso real. Palavras fora do vocabulário são soletradas com
uma datilologia simplificada (letras com a mesma configuração de mão não são diferenciadas).

### Trocar a aparência do avatar
Toda a aparência está em `rig.js`. Para usar um modelo GLB no futuro, basta reescrever `buildRig` mantendo o contrato acima e a convenção de ângulos de `signs.js`; `signs.js` e `avatar.js` não mudam.

Para adicionar um sinal: crie uma entrada em `SIGNS` (lista de quadros `{ pose, t, h }`).

## Libras → Texto
Câmera + MediaPipe Hands, com sinais ensinados pelo próprio usuário (kNN local).
