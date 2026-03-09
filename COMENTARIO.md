Criar um aplicativo de apostas da lotofácil, com uma função inteligente, que gere 15 números, balanceando a aleatoriedade com técnicas estatísticas comprovadas e uma restrição de espaçamento.


O aplicativo deve conter um campo para ser colocado os 10 número que mais saíram e então o algoritmo deverá fazer com base neses números e com base nas técnicas encontradas nas pesquisas, os 15 números aleatórios, esse campo sera opcional ou seja mesmo sem preencher esse campo o botão de gerar os 15 números e deverá funcionar com as técnicas e a regra do espaçamento normalmente.

Outro campo será para selecionar a quantidade de apostas de 15 números, podendo gerar de 1 a 10 apostas de 15 números.

Instruções:

1.  Pesquisa Estratégica (Pré-requisito):
Execute uma pesquisa exaustiva na internet (em grandes bancos de dados e fontes estatísticas) sobre as melhores e mais exatas técnicas de aposta e probabilidades para a Loto Fácil (que sorteia 15 números de 25).
Resuma as técnicas encontradas, focando em padrões de dezenas pares/ímpares, números primos, números repetidos do concurso anterior, e qualquer outra regra estatística que aumente a probabilidade de acerto (ou que seja comumente usada por apostadores experientes).

2.  Função de Geração de Números (Ao Comando do Botão):
Ao ser acionada, a função deve gerar exatamente 15 números únicos, variando de 1 a 25.

3.  Aplicação das Regras: A geração dos 15 números deve ser um processo híbrido:

a) Base Aleatória: Os números devem ser fundamentalmente aleatórios para garantir a cobertura do universo de possibilidades.

b) Incorporação das Técnicas:A seleção final dos 15 números deve ser ponderada e ajustada para seguir as tendências e probabilidades resumidas na Etapa 1. A IA deve explicar como as técnicas pesquisadas influenciaram a seleção final.

4.  Restrição de Espaçamento:

Implemente uma restrição rígida: O intervalo (gap) entre dois números consecutivos sorteados NUNCA pode ultrapassar três casas.
Exemplo prático: Se o número sorteado for X, o próximo número sorteado Y deve satisfazer a condição: $1 \le (Y - X) \le 3$ (assumindo que os números são ordenados após a seleção inicial). Se a geração aleatória/técnica violar essa regra, o número deve ser ajustado ou substituído para cumprir o espaçamento máximo de 3.

---------------------------------------------------------------------------

Em qual parte do codigo JS voce aplicou a regra do espaçamento, caso eu queira mudar?

A regra do espaçamento máximo de 3 casas foi aplicada no arquivo principal de lógica JavaScript (

app.js
), dentro da função 

generateSingleBet
.

Em vez de gerar todos os 15 números e depois verificar se a regra foi quebrada (o que causaria muitos descartes e lentidão), o algoritmo já constrói a sequência passo a passo, limitando a distância para o próximo número.

Se você quiser alterar o limite de espaçamento (por exemplo, permitir um "gap" de até 4 ou 5 casas), você precisa mudar o código em dois lugares na função 

generateSingleBet
:

1. Na escolha do primeiro número da aposta:
No início da função, o primeiro número sorteado já é limitado para não ser maior do que o gap máximo (neste caso, 3):

javascript
// ... dentro de generateSingleBet ...
let seq = [];
// SE QUISER ALTERAR PARA GAP MÁXIMO DE 4, MUDE PARA: [1, 2, 3, 4]
let candidates = [1, 2, 3]; 
let current = candidates[Math.floor(Math.random() * candidates.length)];
seq.push(current);

2. No loop que gera os próximos 14 números:
Dentro do laço for, existe uma verificação de passos válidos (steps) a partir do número atual. É aqui que eu delimito que o próximo número só pode estar até 3 casas de distância:

javascript
for (let i = 1; i < 15; i++) {
    let maxAllowedByLength = 10 + i;
    let validSteps = [];
    
    // SE QUISER ALTERAR PARA GAP MÁXIMO DE 4, MUDE PARA: step <= 4
    for (let step = 1; step <= 3; step++) { 
        let nextNum = current + step;
        if (nextNum <= 25 && nextNum <= 10 + (i + 1)) {
            validSteps.push(step);
        }
    }
}
    // ...
Portanto, basta procurar por essa linha for (let step = 1; step <= 3; step++) e alterar o número 3 para o valor máximo de salto que você deseja permitir!