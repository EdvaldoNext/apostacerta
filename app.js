document.addEventListener('DOMContentLoaded', () => {
    const supabaseUrl = 'https://nvojtlglmyezxrsxxdcp.supabase.co'; // Substitua pela sua URL do Supabase
    const supabaseKey = 'sb_publishable_Gb7ROVtVDbmsGE7pAMskew_xoBC4H5t'; // Substitua pela sua anon key do Supabase
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

    const btnGenerate = document.getElementById('generate-btn');
    const inputHot = document.getElementById('hot-numbers');
    const inputCount = document.getElementById('bet-count');
    const errorMsg = document.getElementById('hot-numbers-error');
    const resultsSection = document.getElementById('results-section');
    const gamesContainer = document.getElementById('games-container');
    const btnLoader = document.getElementById('btn-loader');
    const btnText = btnGenerate.querySelector('span');

    const PRIMES = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23]);

    btnGenerate.addEventListener('click', async () => {
        const rawHotNumbers = inputHot.value.trim();
        const betCount = parseInt(inputCount.value, 10);

        // Validation
        let hotNumbers = [];
        errorMsg.textContent = '';
        if (rawHotNumbers) {
            const parts = rawHotNumbers.split(',').map(s => s.trim()).filter(s => s.length > 0);
            hotNumbers = parts.map(n => parseInt(n, 10));

            const invalidNumbers = hotNumbers.filter(n => isNaN(n) || n < 1 || n > 25);
            if (invalidNumbers.length > 0) {
                errorMsg.textContent = 'Erro: Os números devem ser entre 1 e 25 válidos.';
                return;
            }
            if (hotNumbers.length > 10) {
                errorMsg.textContent = 'Aviso: Selecione no máximo 10 números favoritos.';
                return;
            }
            if (new Set(hotNumbers).size !== hotNumbers.length) {
                errorMsg.textContent = 'Erro: Existem números repetidos.';
                return;
            }
        }

        let betsToGenerate = betCount;
        if (isNaN(betsToGenerate) || betsToGenerate < 1) betsToGenerate = 1;
        if (betsToGenerate > 10) betsToGenerate = 10;
        inputCount.value = betsToGenerate;

        // UI Loading State
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';
        btnGenerate.disabled = true;

        resultsSection.style.display = 'none';
        gamesContainer.innerHTML = '';

        // Generate combinations asynchronously so UI updates
        setTimeout(() => {
            const bets = generateBets(betsToGenerate, hotNumbers);
            renderBets(bets, hotNumbers);

            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
            btnGenerate.disabled = false;
            resultsSection.style.display = 'block';
            resultsSection.scrollIntoView({ behavior: 'smooth' });

            // Salvar histórico no Supabase
            if (supabaseUrl !== 'SUA_URL_AQUI' && supabaseKey !== 'SUA_ANON_KEY_AQUI') {
                console.log("Tentando salvar no Supabase...", { quantidade_apostas: betsToGenerate });

                // Pegar apenas os números de cada aposta
                const numerosParaSalvar = bets.map(b => b.numbers);

                supabase.from('historico_apostas')
                    .insert([{
                        quantidade_apostas: betsToGenerate,
                        numeros: numerosParaSalvar
                    }])
                    .then(({ error }) => {
                        if (error) {
                            console.error("ERRO DETALHADO DO SUPABASE:", error);
                            alert("Erro ao salvar no banco: " + error.message);
                        } else {
                            console.log("SUCESSO: Histórico salvo no Supabase!");
                        }
                    })
                    .catch(err => console.error("Erro de conexão:", err));
            } else {
                console.warn("Chaves do Supabase não configuradas.");
            }
        }, 100);
    });

    // --- LÓGICA DO HISTÓRICO ---
    const historyModal = document.getElementById('history-modal');
    const btnViewHistory = document.getElementById('view-history-btn');
    const closeBtn = document.querySelector('.close-btn');
    const historyList = document.getElementById('history-list');

    btnViewHistory.addEventListener('click', async () => {
        historyModal.style.display = 'block';
        historyList.innerHTML = '<p style="text-align:center;">Carregando seus jogos...</p>';

        try {
            const { data, error } = await supabase
                .from('historico_apostas')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            if (!data || data.length === 0) {
                historyList.innerHTML = '<p style="text-align:center;">Nenhum jogo encontrado.</p>';
                return;
            }

            historyList.innerHTML = '';
            data.forEach(item => {
                const date = new Date(item.created_at).toLocaleString('pt-BR');
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';

                let betsHtml = '';
                if (item.numeros && Array.isArray(item.numeros)) {
                    item.numeros.forEach((nums, i) => {
                        betsHtml += `
                            <div class="bet-row">
                                <strong>Jogo ${i + 1}:</strong>
                                <div class="bet-numbers-small">
                                    ${nums.map(n => `<span class="num-mini">${n < 10 ? '0' + n : n}</span>`).join('')}
                                </div>
                            </div>
                        `;
                    });
                }

                historyItem.innerHTML = `
                    <div class="history-date">📅 ${date} - ${item.quantidade_apostas} apostas</div>
                    <div class="history-bets">${betsHtml}</div>
                `;
                historyList.appendChild(historyItem);
            });
        } catch (err) {
            console.error(err);
            historyList.innerHTML = '<p style="color:red;">Erro ao carregar histórico.</p>';
        }
    });

    closeBtn.onclick = () => historyModal.style.display = 'none';
    window.onclick = (event) => { if (event.target == historyModal) historyModal.style.display = 'none'; }


    function generateBets(count, hotNumbers) {
        const bets = [];
        for (let i = 0; i < count; i++) {
            let bet = null;
            let maxRetries = 10000;
            let currentRetry = 0;

            while (!bet && currentRetry < maxRetries) {
                currentRetry++;
                // Slowly relax the rules if it's too hard (e.g., impossible hot combinations)
                let relaxRules = currentRetry > 8000;
                bet = generateSingleBet(hotNumbers, relaxRules);
            }

            if (bet) {
                bets.push(bet);
            } else {
                console.warn('Failed to generate a bet after 10000 attempts');
            }
        }
        return bets;
    }

    function generateSingleBet(hotNumbers, relaxRules) {
        let seq = [];
        let candidates = [1, 2, 3, 4]; // First number can be 1, 2, or 3 (gap <= 3 from 0 conceptually)

        let current = candidates[Math.floor(Math.random() * candidates.length)];
        seq.push(current);

        let failed = false;

        for (let i = 1; i < 15; i++) {
            let maxAllowedByLength = 10 + i; // next number must not exceed this to leave room for the rest

            let validSteps = [];
            for (let step = 1; step <= 4; step++) {
                let nextNum = current + step;
                if (nextNum <= 25 && nextNum <= 10 + (i + 1)) {
                    validSteps.push(step);
                }
            }

            if (validSteps.length === 0) {
                failed = true;
                break;
            }

            let weightedSteps = [];
            for (let step of validSteps) {
                let nextNum = current + step;
                let weight = 1;
                // If it's a hot number, give it higher probability
                if (hotNumbers.includes(nextNum)) {
                    weight = relaxRules ? 2 : 5;
                }
                for (let w = 0; w < weight; w++) {
                    weightedSteps.push(step);
                }
            }

            let chosenStep = weightedSteps[Math.floor(Math.random() * weightedSteps.length)];
            current = current + chosenStep;
            seq.push(current);
        }

        if (failed) return null;

        // Statistics Validation
        let evens = seq.filter(n => n % 2 === 0).length;
        let odds = seq.length - evens;

        if (!relaxRules) {
            if (!((evens === 7 && odds === 8) || (evens === 8 && odds === 7))) return null;
        } else {
            // Relaxed: Allow 6/9 or 9/6
            if (evens < 6 || evens > 9) return null;
        }

        let primes = seq.filter(n => PRIMES.has(n)).length;
        if (!relaxRules) {
            if (primes < 6 || primes > 8) return null;
        } else {
            // Relaxed
            if (primes < 4 || primes > 9) return null;
        }

        let sum = seq.reduce((a, b) => a + b, 0);
        if (sum < 171 || sum > 220) return null;

        // Gap Validation is implicitly handled by `validSteps` restricting step to <= 3

        return {
            numbers: seq,
            stats: { evens, odds, primes, sum }
        };
    }

    function renderBets(bets, hotNumbers) {
        bets.forEach((bet, index) => {
            const card = document.createElement('div');
            card.className = 'game-card';

            const numGrid = document.createElement('div');
            numGrid.className = 'numbers-grid';

            bet.numbers.forEach(num => {
                const ball = document.createElement('div');
                ball.className = `number-ball ${hotNumbers.includes(num) ? 'hot' : ''}`;
                ball.textContent = num < 10 ? `0${num}` : num;
                numGrid.appendChild(ball);
            });

            card.innerHTML = `
                <div class="game-header">
                    <span>Aposta #${index + 1}</span>
                    <span style="color: var(--accent); font-size: 0.9em;">${hotNumbers.length > 0 ? (bet.numbers.filter(n => hotNumbers.includes(n)).length + ' favoritos incluídos') : 'Balanceado'}</span>
                </div>
            `;

            card.appendChild(numGrid);

            const footer = document.createElement('div');
            footer.className = 'game-footer';
            footer.innerHTML = `
                <span class="stat-chip">Pares: ${bet.stats.evens} | Ímpares: ${bet.stats.odds}</span>
                <span class="stat-chip">Primos: ${bet.stats.primes}</span>
                <span class="stat-chip">Soma: ${bet.stats.sum}</span>
            `;

            card.appendChild(footer);
            gamesContainer.appendChild(card);
        });
    }
});
