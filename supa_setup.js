const https = require('https');

const token = 'sbp_e3d8ca49675ed9b9ae1c233064f812f32cbb6b8c';
const projectId = 'nvojtlglmyezxrsxxdcp';

function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.supabase.com',
            path: `/v1/projects/${projectId}${path}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log("Fetching API Keys...");
        const keysRes = await makeRequest('/api-keys');
        console.log("Keys Status:", keysRes.status);

        const keysData = JSON.parse(keysRes.data);
        console.log(keysData);

        const anonKeyToken = keysData.find(k => k.name === 'anon' || k.tags === 'anon')?.api_key;
        console.log("Found Anon Key:", anonKeyToken ? anonKeyToken.substring(0, 15) + "..." : "Not found");

        console.log("\nRunning SQL Migration...");
        const sql = `
            CREATE TABLE IF NOT EXISTS public.historico_apostas (
              id uuid default gen_random_uuid() primary key,
              created_at timestamp with time zone default timezone('utc'::text, now()) not null,
              quantidade_apostas integer not null
            );
            ALTER TABLE public.historico_apostas ENABLE ROW LEVEL SECURITY;
            DO $$ BEGIN
                CREATE POLICY "Allow anonymous inserts" ON public.historico_apostas FOR INSERT TO anon WITH CHECK (true);
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
            DO $$ BEGIN
                CREATE POLICY "Allow anonymous selects" ON public.historico_apostas FOR SELECT TO anon USING (true);
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `;
        const sqlRes = await makeRequest('/database/query', 'POST', { query: sql });
        console.log("SQL Status:", sqlRes.status);
        console.log("SQL Data:", sqlRes.data);

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
