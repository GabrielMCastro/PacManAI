// The development server. Serves the project's files to the browser (the training page is index.html,
// everything else is loaded by it as ES modules) and has one small API for the networks saved in ai/seeds:
//   GET  /api/seeds  -> { count }   how many networks are saved (shown in the config editor and save dialog)
//   POST /api/seeds  <- { header, genomes } replaces the saved networks with these -> { saved } or { error }
// The browser can't write files itself, so saving (simulationenvironment.js saveNetworks) goes through here.
// Loading seeds doesn't need the API: the trainer fetches ai/seeds/net_N.txt as plain static files.
//
// Start it from this folder with `deno task start` (see deno.json), which grants:
//   --allow-net              listen on the port
//   --allow-read             serve the files
//   --allow-write=ai/seeds   save networks, nowhere else. Without it saving fails with a permission error
// NOTE: --allow-write=ai/seeds and the static file root are relative to the working directory, while
// SEEDS_DIR is relative to this file, so the server has to be started from this folder (PacManSimplified)
// for everything to line up
//
// Uses abc, a small Express-like web framework for Deno.
// NOTE: the abc import has no version in its URL, so it resolves to whatever the latest version is
// (deno.land redirects it, currently to abc@v1.3.3)
import {Application} from 'https://deno.land/x/abc/mod.ts';

const app = new Application();

// Saved networks, loaded by the trainer when SeedNumber is set
const SEEDS_DIR = new URL("./ai/seeds/", import.meta.url)
// Validation for POST /api/seeds, so the endpoint only ever writes well formed seed files with safe names.
// The formats are the ones snapshotNetworks() (simulationenvironment.js) sends and getGenome() produces;
// weights are stored as integers x100, the optional decimal part is just lenient
const SEED_FILE = /^net_\d+\.txt$/
const HEADER = /^\d+\.\d+\.\d+\.\d+\.$/          // innovations.inputs.hidden.outputs.
const GENE = /^\d+\.\d+\.\d+\.-?\d+(\.\d+)?\.[01]$/ // innovation.from.to.weight.enabled

// Number of networks saved, counting net_0.txt, net_1.txt, ... until one is missing
// Counting stops at the first gap because the trainer loads net_0 to net_(SeedNumber - 1) in order,
// so files after a gap couldn't be loaded anyway. 0 if the folder doesn't exist yet
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
// Every existing net_N.txt is deleted first, so a smaller save doesn't leave old networks from a bigger one
// behind (they'd be counted and loaded with the new ones). Then genome i is written to net_i.txt as
// JSON [header, [gene, ...]], the format the trainer and visualize.js parse.
// Responds 400 if the body doesn't match the formats above, 500 if writing fails, else { saved: count }.
// NOTE: the old files are deleted before the new ones are written, so a failure partway through leaves
// ai/seeds with only some of the new networks
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
        // The usual cause: the server was started without write permission (not with deno task start)
        const error = e instanceof Deno.errors.PermissionDenied
            ? "The server can't write to ai/seeds, restart it with --allow-write=ai/seeds"
            : e.message
        return c.json({ error }, 500)
    }
    return c.json({ saved: genomes.length })
})

// Port can be given as an argument: deno task start 8001
// Everything else is served as static files from the working directory: a request for /x reads ./x
// (abc joins the path onto Deno.cwd()). There's no directory index, so open /index.html, not /
// NOTE: visualize.js fetches from http://localhost:8000 directly, so it only works on the default port
app.static("/", "/").start({ port: Number(Deno.args[0] ?? 8000) })
