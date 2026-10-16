import {Application} from 'https://deno.land/x/abc/mod.ts';

const app = new Application();

// Saved networks, loaded by the trainer when SeedNumber is set
const SEEDS_DIR = new URL("./ai/seeds/", import.meta.url)
const SEED_FILE = /^net_\d+\.txt$/
const HEADER = /^\d+\.\d+\.\d+\.\d+\.$/          // innovations.inputs.hidden.outputs.
const GENE = /^\d+\.\d+\.\d+\.-?\d+(\.\d+)?\.[01]$/ // innovation.from.to.weight.enabled

// Number of networks saved, counting net_0.txt, net_1.txt, ... until one is missing
async function countSeeds() {
    const names = new Set()
    try {
        for await (const f of Deno.readDir(SEEDS_DIR)) names.add(f.name)
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) return 0
        throw e
    }
    let count = 0
    while (names.has(`net_${count}.txt`)) count++
    return count
}

app.get("/api/seeds", async (c) => c.json({ count: await countSeeds() }))

// Replace the saved networks with { header, genomes: [[gene, ...], ...] }
app.post("/api/seeds", async (c) => {
    const { header, genomes } = await c.body ?? {}
    const valid = typeof header == "string" && HEADER.test(header) && Array.isArray(genomes) &&
        genomes.every(g => Array.isArray(g) && g.every(gene => typeof gene == "string" && GENE.test(gene)))
    if (!valid) return c.json({ error: "Invalid networks" }, 400)

    try {
        await Deno.mkdir(SEEDS_DIR, { recursive: true })
        for await (const f of Deno.readDir(SEEDS_DIR)) {
            if (SEED_FILE.test(f.name)) await Deno.remove(new URL(f.name, SEEDS_DIR))
        }
        for (let i = 0; i < genomes.length; i++) {
            await Deno.writeTextFile(new URL(`net_${i}.txt`, SEEDS_DIR), JSON.stringify([header, genomes[i]]))
        }
    } catch (e) {
        const error = e instanceof Deno.errors.PermissionDenied
            ? "The server can't write to ai/seeds, restart it with --allow-write=ai/seeds"
            : e.message
        return c.json({ error }, 500)
    }
    return c.json({ saved: genomes.length })
})

// Port can be given as an argument: deno task start 8001
app.static("/", "/").start({ port: Number(Deno.args[0] ?? 8000) })
